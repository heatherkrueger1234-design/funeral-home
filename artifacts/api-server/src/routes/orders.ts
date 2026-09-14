import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  catalogueItemsTable,
  catalogueCategoriesTable,
  cataloguePackageItemsTable,
  cataloguePackagesTable,
  merchandiseSelectionItemsTable,
  merchandiseSelectionsTable,
  isBehindTheGpl,
  mayDiscussPayment,
  type Case,
  type CatalogueItem,
  type FuneralHome,
  type MerchandiseSelection,
  type MerchandiseSelectionItem,
} from "@workspace/db";
import { badRequest, parseBody, parseId, requireRow } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import { familyCase, familyHome } from "../middleware/require-family";
import { serveUpload } from "../lib/media";
import {
  AddSelectionItemBody,
  AddSelectionPackageBody,
} from "@workspace/api-zod";
import {
  assertMayShowCaskets,
  blankToNull,
  parseFamilyProvided,
  parseSelectionLineUpdate,
  parseSelectionUpdate,
  browsableSections,
  catalogueFor,
  dataUri,
  ensureSelection,
  mayShowCaskets,
  nextLinePosition,
  packagesFor,
  selectionFor,
  settingsFor,
  toCatalogueJson,
  toPackageJson,
  toSelectionJson,
} from "../lib/storefront";
import {
  hostOf,
  renderStatement,
  type PriceListKind,
} from "../lib/price-list-render";
import { renderPriceListFor, sendPrintable } from "./catalogue";
import { loadCase } from "./cases";

/**
 * What a family chose, and the statement that comes out of it.
 *
 * Two routers live here. The director's is mounted behind the staff session
 * gate; the family's is exported and mounted behind the link gate, which is
 * why no path in it carries a case id — the token names the case and there
 * is nothing for a handler to forget to check.
 *
 * The Funeral Rule's two structural demands shape every handler below.
 * Everything is itemised, always: a line carries the price of the thing on
 * it, a package writes its members as ordinary lines plus one adjustment,
 * and there is no way through this file to record a purchase without a
 * per-item price. And removing anything changes the total, immediately, in
 * front of whoever is looking at it.
 *
 * The third demand is an absence. A family bringing their own casket or urn
 * goes down a path with no price on it at all, because a provider may not
 * refuse a third-party casket and may not charge for handling one.
 *
 * Every path here is in `openapi.yaml` under the `orders` tag, and both front
 * ends reach them through the hooks orval generates from it.
 */

const router: IRouter = Router();

/* ---------------------------------------------------------- the machinery */

type Actor = { funeralHomeId: number; case: Case };

async function selectionOrEmpty(actor: Actor) {
  return ensureSelection(actor.case.id, actor.funeralHomeId);
}

/**
 * A selection stops taking changes once the director has agreed it.
 *
 * The statement is the document the home hands a family at the end of an
 * arrangement, and a document that keeps changing after it is handed over is
 * not a document. Reopening is a deliberate act by a director, which is why
 * it lives on their side of the gate and not the family's.
 */
function assertOpen(selection: MerchandiseSelection): void {
  if (selection.status === "confirmed") {
    throw badRequest(
      "This arrangement has been agreed. Ask the funeral home to reopen it if something needs to change.",
    );
  }
}

async function loadCatalogueItem(
  funeralHomeId: number,
  itemId: number,
): Promise<CatalogueItem & { section: string }> {
  const [row] = await db
    .select({
      item: catalogueItemsTable,
      section: catalogueCategoriesTable.section,
    })
    .from(catalogueItemsTable)
    .innerJoin(
      catalogueCategoriesTable,
      eq(catalogueItemsTable.categoryId, catalogueCategoriesTable.id),
    )
    .where(
      and(
        eq(catalogueItemsTable.id, itemId),
        eq(catalogueItemsTable.funeralHomeId, funeralHomeId),
        isNull(catalogueItemsTable.archivedAt),
        isNull(catalogueCategoriesTable.archivedAt),
      ),
    )
    .limit(1);

  const found = requireRow(row, "That is no longer in the catalogue.");
  return { ...found.item, section: found.section };
}

/**
 * Stamp which price list this selection is being priced from.
 *
 * Done once, when the first line is written, and never rewritten afterwards.
 * A home that raises its prices in March must not be able to change what a
 * family agreed in February, and the effective date on the statement is what
 * proves which list the numbers came from.
 */
async function stampPriceList(
  selection: MerchandiseSelection,
  funeralHomeId: number,
): Promise<void> {
  if (selection.gplEffectiveOn !== null) return;

  const settings = await settingsFor(funeralHomeId);
  if (!settings?.gplEffectiveOn) return;

  await db
    .update(merchandiseSelectionsTable)
    .set({ gplEffectiveOn: settings.gplEffectiveOn, updatedAt: new Date() })
    .where(eq(merchandiseSelectionsTable.id, selection.id));
}

async function touchSelection(selectionId: number): Promise<void> {
  await db
    .update(merchandiseSelectionsTable)
    .set({ updatedAt: new Date() })
    .where(eq(merchandiseSelectionsTable.id, selectionId));
}

async function addItem(
  actor: Actor,
  values: { itemId: number; quantity?: number },
): Promise<void> {
  const { selection } = await selectionOrEmpty(actor);
  assertOpen(selection);

  const item = await loadCatalogueItem(actor.funeralHomeId, values.itemId);

  if (isBehindTheGpl(item.section)) {
    const settings = await settingsFor(actor.funeralHomeId);
    assertMayShowCaskets(settings, selection);
  }

  await db.insert(merchandiseSelectionItemsTable).values({
    funeralHomeId: actor.funeralHomeId,
    selectionId: selection.id,
    kind: "item",
    catalogueItemId: item.id,
    name: item.name,
    description: item.description,
    section: item.section,
    unitPriceCents: item.priceCents,
    quantity: values.quantity ?? 1,
    position: await nextLinePosition(selection.id),
  });

  await stampPriceList(selection, actor.funeralHomeId);
  await touchSelection(selection.id);
}

/**
 * Choosing a package.
 *
 * It writes the package's items as ordinary itemised lines and then one
 * adjustment line carrying the difference between the home's package price
 * and what those items come to individually. That is not a formality: it is
 * what keeps the Rule's two requirements true at once. Every item still
 * shows its own price, and declining any one of them works exactly as
 * declining anything else does — the item goes, the adjustment goes with it,
 * and the total moves in front of the family.
 */
async function addPackage(actor: Actor, packageId: number): Promise<void> {
  const { selection } = await selectionOrEmpty(actor);
  assertOpen(selection);

  const [pack] = await db
    .select()
    .from(cataloguePackagesTable)
    .where(
      and(
        eq(cataloguePackagesTable.id, packageId),
        eq(cataloguePackagesTable.funeralHomeId, actor.funeralHomeId),
        isNull(cataloguePackagesTable.archivedAt),
      ),
    )
    .limit(1);

  const chosen = requireRow(pack, "That package is no longer offered.");

  const members = await db
    .select({
      item: catalogueItemsTable,
      quantity: cataloguePackageItemsTable.quantity,
      section: catalogueCategoriesTable.section,
    })
    .from(cataloguePackageItemsTable)
    .innerJoin(
      catalogueItemsTable,
      eq(cataloguePackageItemsTable.itemId, catalogueItemsTable.id),
    )
    .innerJoin(
      catalogueCategoriesTable,
      eq(catalogueItemsTable.categoryId, catalogueCategoriesTable.id),
    )
    .where(
      and(
        eq(cataloguePackageItemsTable.packageId, chosen.id),
        isNull(catalogueItemsTable.archivedAt),
      ),
    );

  if (members.length === 0) {
    throw badRequest("There is nothing in that package any more.");
  }

  if (members.some((member) => isBehindTheGpl(member.section))) {
    const settings = await settingsFor(actor.funeralHomeId);
    assertMayShowCaskets(settings, selection);
  }

  const itemised = members.reduce(
    (total, member) => total + member.item.priceCents * member.quantity,
    0,
  );

  let position = await nextLinePosition(selection.id);

  await db.transaction(async (tx) => {
    for (const member of members) {
      await tx.insert(merchandiseSelectionItemsTable).values({
        funeralHomeId: actor.funeralHomeId,
        selectionId: selection.id,
        kind: "item",
        catalogueItemId: member.item.id,
        packageId: chosen.id,
        name: member.item.name,
        description: member.item.description,
        section: member.section,
        unitPriceCents: member.item.priceCents,
        quantity: member.quantity,
        position: position++,
      });
    }

    // Only when there is a difference. A package priced at exactly the sum
    // of its parts is a shortcut for the director, not a discount, and a
    // "$0.00 adjustment" line on a statement is a question nobody can answer.
    if (chosen.priceCents !== itemised) {
      await tx.insert(merchandiseSelectionItemsTable).values({
        funeralHomeId: actor.funeralHomeId,
        selectionId: selection.id,
        kind: "package_adjustment",
        packageId: chosen.id,
        name: `${chosen.name} — package price`,
        description:
          "The difference between these items bought separately and the package price.",
        unitPriceCents: chosen.priceCents - itemised,
        quantity: 1,
        position: position++,
      });
    }
  });

  await stampPriceList(selection, actor.funeralHomeId);
  await touchSelection(selection.id);
}

async function addFamilyProvided(
  actor: Actor,
  values: { name: string; notes?: string | null },
): Promise<void> {
  const { selection } = await selectionOrEmpty(actor);
  assertOpen(selection);

  /*
   * No price is read, no price is written, and the column is left null —
   * which the table's own check constraint insists on. A funeral provider
   * may not refuse a casket or urn a family bought elsewhere and may not
   * charge a handling fee for one, so there is nothing here for a fee to be
   * put into, on this path or any other.
   */
  await db.insert(merchandiseSelectionItemsTable).values({
    funeralHomeId: actor.funeralHomeId,
    selectionId: selection.id,
    kind: "family_provided",
    name: values.name,
    notes: blankToNull(values.notes),
    quantity: 1,
    position: await nextLinePosition(selection.id),
  });

  await touchSelection(selection.id);
}

async function loadLine(
  actor: Actor,
  lineId: number,
): Promise<MerchandiseSelectionItem> {
  const existing = await selectionFor(actor.case.id, actor.funeralHomeId);
  if (!existing) throw badRequest("Nothing has been chosen yet.");

  const line = existing.lines.find((row) => row.id === lineId);
  return requireRow(line, "That is no longer on the list.");
}

/**
 * Taking something off the list.
 *
 * When the line came in as part of a package, the package's adjustment goes
 * with it. The family bought the set at the set's price; once the set is
 * broken, everything left stands at its own price, which is both what the
 * Rule requires and what a home would tell them across a desk.
 */
async function removeLine(actor: Actor, lineId: number): Promise<void> {
  const { selection } = await selectionOrEmpty(actor);
  assertOpen(selection);

  const line = await loadLine(actor, lineId);

  await db.transaction(async (tx) => {
    await tx
      .delete(merchandiseSelectionItemsTable)
      .where(eq(merchandiseSelectionItemsTable.id, line.id));

    if (line.packageId !== null && line.kind === "item") {
      await tx
        .delete(merchandiseSelectionItemsTable)
        .where(
          and(
            eq(merchandiseSelectionItemsTable.selectionId, selection.id),
            eq(merchandiseSelectionItemsTable.packageId, line.packageId),
            eq(merchandiseSelectionItemsTable.kind, "package_adjustment"),
          ),
        );
    }
  });

  await touchSelection(selection.id);
}

async function updateLine(
  actor: Actor,
  lineId: number,
  values: { quantity?: number; notes?: string | null },
): Promise<void> {
  const { selection } = await selectionOrEmpty(actor);
  assertOpen(selection);

  const line = await loadLine(actor, lineId);

  if (line.kind === "package_adjustment") {
    throw badRequest(
      "A package's price adjustment follows its items. Change one of them instead.",
    );
  }

  await db
    .update(merchandiseSelectionItemsTable)
    .set({
      ...(values.quantity === undefined ? {} : { quantity: values.quantity }),
      ...(values.notes === undefined ? {} : { notes: blankToNull(values.notes) }),
      updatedAt: new Date(),
    })
    .where(eq(merchandiseSelectionItemsTable.id, line.id));

  await touchSelection(selection.id);
}

/* ------------------------------------------------------ what both sides see */

/**
 * Where a family is told to send the money, which is never to us.
 *
 * Four rules are baked into this one function so that neither front end can
 * get them wrong. A pre-need plan gets nothing at all — recording a plan is
 * lawful and taking money for it is a licensed activity we do not perform.
 * A draft gets nothing, because a family should not be nudged towards paying
 * for an arrangement the director has not yet agreed. Once the director has
 * ticked it off against their own books the link goes away, because asking
 * somebody to pay again for their mother's funeral is the worst version of
 * this screen there is. And what comes back is a link and some words, never
 * an amount received or a status: we do not process payments, so we do not
 * know, and saying otherwise would be a lie told to somebody at their most
 * trusting.
 */
async function paymentHandoff(
  funeralHomeId: number,
  home: FuneralHome,
  subject: Case,
  selection: MerchandiseSelection,
): Promise<Record<string, unknown> | null> {
  if (!mayDiscussPayment(subject)) return null;
  if (selection.status !== "confirmed") return null;
  if (selection.settledAt !== null) return null;

  const settings = await settingsFor(funeralHomeId);
  const url = settings?.paymentPageUrl?.trim() || null;

  return {
    /** The home's own page, at the home's own processor. Never ours. */
    url,
    /** Shown beside the link so nobody is surprised by where it goes. */
    host: url ? hostOf(url) : null,
    instructions: settings?.paymentInstructions?.trim() || null,
    /** The number to ring when there is no link, which is not an error. */
    phone: home.phone,
  };
}

async function storefrontPayload(options: {
  funeralHomeId: number;
  home: FuneralHome;
  case: Case;
  /** Staff see everything; a family sees only what the GPL has unlocked. */
  forFamily: boolean;
}) {
  const { funeralHomeId, forFamily } = options;

  const settings = await settingsFor(funeralHomeId);
  const entry = await ensureSelection(options.case.id, funeralHomeId);

  const sections = forFamily
    ? browsableSections(settings, entry.selection)
    : undefined;

  const tree = await catalogueFor(funeralHomeId, { sections });
  const allItems = (
    sections ? await catalogueFor(funeralHomeId) : tree
  ).flatMap((block) => block.items);

  /*
   * A package is only offered once everything in it may be shown. Otherwise
   * a family who has not been given the price list could reach a casket
   * through a package, which is the sequence the Rule is about.
   */
  const packages = mayShowCaskets(settings, entry.selection) || !forFamily
    ? (await packagesFor(funeralHomeId)).map((pack) =>
        toPackageJson(pack, allItems),
      )
    : [];

  return {
    hasGeneralPriceList: settings?.gplEffectiveOn != null,
    gplEffectiveOn: settings?.gplEffectiveOn ?? null,
    /** Whether caskets and vaults are showing yet, and why not if they are not. */
    casketsUnlocked: mayShowCaskets(settings, entry.selection),
    categories: toCatalogueJson(tree),
    packages,
    selection: toSelectionJson(entry),
    payment: await paymentHandoff(
      funeralHomeId,
      options.home,
      options.case,
      entry.selection,
    ),
    /** Nothing is owed on a plan, and nothing is collected on one. */
    mayDiscussPayment: mayDiscussPayment(options.case),
  };
}

/**
 * Record that this family has the General Price List.
 *
 * Set by the family opening it, and by a director recording that they handed
 * one across the desk. Both are the same fact and both unlock the same
 * thing, which is the point: the Rule cares that the family has the list,
 * not which way it reached them.
 */
async function recordGplShown(selection: MerchandiseSelection): Promise<void> {
  if (selection.gplShownAt !== null) return;

  await db
    .update(merchandiseSelectionsTable)
    .set({ gplShownAt: new Date(), updatedAt: new Date() })
    .where(eq(merchandiseSelectionsTable.id, selection.id));
}

async function renderStatementFor(options: {
  home: FuneralHome;
  case: Case;
  funeralHomeId: number;
}): Promise<string> {
  const entry = await ensureSelection(options.case.id, options.funeralHomeId);
  const settings = await settingsFor(options.funeralHomeId);

  return renderStatement({
    home: options.home,
    case: options.case,
    settings,
    selection: entry.selection,
    lines: entry.lines,
    logoDataUri: await dataUri(options.home.logoUploadId),
  });
}

/* ------------------------------------------------------------- director -- */

function staffActor(req: Parameters<typeof tenant>[0], row: Case): Actor {
  return { funeralHomeId: tenant(req).id, case: row };
}

router.get("/cases/:caseId/selection", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  res.json(
    await storefrontPayload({
      funeralHomeId: home.id,
      home,
      case: row,
      forFamily: false,
    }),
  );
});

router.post("/cases/:caseId/selection/gpl-given", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const entry = await ensureSelection(row.id, home.id);

  await recordGplShown(entry.selection);

  res.json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

router.post("/cases/:caseId/selection/items", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  await addItem(staffActor(req, row), parseBody(AddSelectionItemBody, req.body));

  res.status(201).json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

router.post("/cases/:caseId/selection/packages", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseBody(AddSelectionPackageBody, req.body);

  await addPackage(staffActor(req, row), values.packageId);

  res.status(201).json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

router.post("/cases/:caseId/selection/family-provided", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  await addFamilyProvided(
    staffActor(req, row),
    parseFamilyProvided(req.body),
  );

  res.status(201).json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

router.put("/cases/:caseId/selection/items/:lineId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  await updateLine(
    staffActor(req, row),
    parseId(req.params.lineId),
    parseSelectionLineUpdate(req.body),
  );

  res.json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

router.delete("/cases/:caseId/selection/items/:lineId", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  await removeLine(staffActor(req, row), parseId(req.params.lineId));

  res.json(toSelectionJson((await selectionFor(row.id, home.id))!));
});

/**
 * Agreeing the arrangement, and later noting that the home's own books say
 * it was paid.
 *
 * `settled` is a note about the home's records and the copy around it says
 * so in those words. We process nothing, hold nothing and confirm nothing:
 * a tick here means a director looked at their own accounts, and if this
 * interface ever implies it means a payment reached us, that is a defect.
 */
router.put("/cases/:caseId/selection", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const values = parseSelectionUpdate(req.body);

  const entry = await ensureSelection(row.id, home.id);

  if (values.settled !== undefined && !mayDiscussPayment(row)) {
    throw badRequest(
      "This is a plan, not a bill. Nothing is owed on it and nothing is collected for it.",
    );
  }

  if (values.confirmed === true && entry.lines.length === 0) {
    throw badRequest("Nothing has been chosen yet.");
  }

  const settings = await settingsFor(home.id);

  await db
    .update(merchandiseSelectionsTable)
    .set({
      ...(values.notes === undefined ? {} : { notes: blankToNull(values.notes) }),
      ...(values.confirmed === undefined
        ? {}
        : values.confirmed
          ? {
              status: "confirmed",
              confirmedAt: new Date(),
              confirmedByUserId: user.id,
              gplEffectiveOn:
                entry.selection.gplEffectiveOn ?? settings?.gplEffectiveOn ?? null,
            }
          : { status: "draft", confirmedAt: null, confirmedByUserId: null }),
      ...(values.settled === undefined
        ? {}
        : values.settled
          ? { settledAt: new Date(), settledByUserId: user.id }
          : { settledAt: null, settledByUserId: null }),
      ...(values.settledNote === undefined
        ? {}
        : { settledNote: blankToNull(values.settledNote) }),
      updatedAt: new Date(),
    })
    .where(eq(merchandiseSelectionsTable.id, entry.selection.id));

  res.json(
    await storefrontPayload({
      funeralHomeId: home.id,
      home,
      case: row,
      forFamily: false,
    }),
  );
});

router.get("/cases/:caseId/statement/render", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  sendPrintable(
    res,
    await renderStatementFor({ home, case: row, funeralHomeId: home.id }),
  );
});

export default router;

/* --------------------------------------------------------------- family -- */

/**
 * The family's storefront.
 *
 * Mounted under `/family`, behind the link gate, alongside the rest of the
 * family surface. No path here names a case, because the token already does.
 */
export const familyStorefrontRouter: IRouter = Router();

function familyActor(req: Parameters<typeof familyCase>[0]): Actor {
  const subject = familyCase(req);
  return { funeralHomeId: subject.funeralHomeId, case: subject };
}

familyStorefrontRouter.get("/storefront", async (req, res) => {
  const subject = familyCase(req);
  const home = familyHome(req);

  res.json(
    await storefrontPayload({
      funeralHomeId: subject.funeralHomeId,
      home,
      case: subject,
      forFamily: true,
    }),
  );
});

/**
 * The price list, as the family reads it — and the moment the sequence turns.
 *
 * Recording that it was opened is a side effect of a GET, which is normally
 * a thing worth avoiding. Here it is the honest option: the fact the Rule
 * cares about is that the family has the list, and that becomes true when
 * the sheet renders, not when a separate request happens to succeed
 * afterwards. The family surface records a link being opened the same way.
 */
familyStorefrontRouter.get(
  "/storefront/price-lists/:kind/render",
  async (req, res) => {
    const subject = familyCase(req);
    const home = familyHome(req);
    const kind = req.params.kind as PriceListKind;

    if (!["gpl", "cpl", "obcpl"].includes(kind)) {
      throw badRequest("That is not one of the price lists.");
    }

    const entry = await ensureSelection(subject.id, subject.funeralHomeId);

    if (kind !== "gpl") {
      const settings = await settingsFor(subject.funeralHomeId);
      assertMayShowCaskets(settings, entry.selection);
    }

    const html = await renderPriceListFor(subject.funeralHomeId, home, kind);

    if (kind === "gpl") await recordGplShown(entry.selection);

    sendPrintable(res, html);
  },
);

familyStorefrontRouter.post("/storefront/items", async (req, res) => {
  const actor = familyActor(req);
  await addItem(actor, parseBody(AddSelectionItemBody, req.body));

  res
    .status(201)
    .json(toSelectionJson((await selectionFor(actor.case.id, actor.funeralHomeId))!));
});

familyStorefrontRouter.post("/storefront/packages", async (req, res) => {
  const actor = familyActor(req);
  const values = parseBody(AddSelectionPackageBody, req.body);

  await addPackage(actor, values.packageId);

  res
    .status(201)
    .json(toSelectionJson((await selectionFor(actor.case.id, actor.funeralHomeId))!));
});

/**
 * "We are bringing our own."
 *
 * There is no price on this request, no price in the row it writes, and no
 * fee anywhere on the path a family walks to get here. The Funeral Rule
 * forbids a provider from refusing a casket or urn bought elsewhere and from
 * charging a handling fee for accepting one, and the surest way to keep a
 * fee out of a product is to build nowhere to put one.
 */
familyStorefrontRouter.post("/storefront/family-provided", async (req, res) => {
  const actor = familyActor(req);
  await addFamilyProvided(actor, parseFamilyProvided(req.body));

  res
    .status(201)
    .json(toSelectionJson((await selectionFor(actor.case.id, actor.funeralHomeId))!));
});

familyStorefrontRouter.put("/storefront/items/:lineId", async (req, res) => {
  const actor = familyActor(req);

  await updateLine(
    actor,
    parseId(req.params.lineId),
    parseSelectionLineUpdate(req.body),
  );

  res.json(
    toSelectionJson((await selectionFor(actor.case.id, actor.funeralHomeId))!),
  );
});

familyStorefrontRouter.delete("/storefront/items/:lineId", async (req, res) => {
  const actor = familyActor(req);
  await removeLine(actor, parseId(req.params.lineId));

  res.json(
    toSelectionJson((await selectionFor(actor.case.id, actor.funeralHomeId))!),
  );
});

familyStorefrontRouter.get("/storefront/statement/render", async (req, res) => {
  const subject = familyCase(req);
  const home = familyHome(req);

  sendPrintable(
    res,
    await renderStatementFor({
      home,
      case: subject,
      funeralHomeId: subject.funeralHomeId,
    }),
  );
});

/**
 * A photograph of something in the catalogue.
 *
 * The home's catalogue photographs are not attached to any case, so the
 * family's ordinary upload route — which serves only files on their own case
 * — cannot reach them, and rightly so. This one checks the file is being
 * used by a live item in this home's catalogue before it serves a byte.
 */
familyStorefrontRouter.get("/storefront/uploads/:uploadId", async (req, res) => {
  const subject = familyCase(req);
  const uploadId = parseId(req.params.uploadId);

  const [row] = await db
    .select({ id: catalogueItemsTable.id })
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.funeralHomeId, subject.funeralHomeId),
        eq(catalogueItemsTable.photoUploadId, uploadId),
        isNull(catalogueItemsTable.archivedAt),
      ),
    )
    .limit(1);

  if (!row) {
    // The same answer as a file that does not exist: a family holding a link
    // should not be able to probe which upload ids their home has.
    throw badRequest("That photograph could not be found.");
  }

  await serveUpload(res, {
    uploadId,
    funeralHomeId: subject.funeralHomeId,
  });
});

