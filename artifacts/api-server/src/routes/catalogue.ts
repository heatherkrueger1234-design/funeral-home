import { Router, type IRouter, type Response } from "express";
import multer from "multer";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  catalogueCategoriesTable,
  catalogueItemsTable,
  cataloguePackageItemsTable,
  cataloguePackagesTable,
  merchandiseSelectionItemsTable,
  storefrontSettingsTable,
  uploadsTable,
  hasGeneralPriceList,
  type CatalogueCategory,
  type CatalogueItem,
  type CataloguePackage,
} from "@workspace/db";
import { badRequest, parseBody, parseId, requireRow } from "../lib/http";
import { tenant } from "../middleware/require-auth";
import {
  CreateCategoryBody,
  CreateItemBody,
  CreatePackageBody,
  UpdateCategoryBody,
  UpdateItemBody,
  UpdatePackageBody,
  UpdateStorefrontSettingsBody,
  catalogueFor,
  dataUri,
  ensureSettings,
  packagesFor,
  priceListCategories,
  settingsFor,
  toCatalogueJson,
  toCategoryJson,
  toItemJson,
  toPackageJson,
  toSettingsJson,
} from "../lib/storefront";
import { renderPriceList, type PriceListKind } from "../lib/price-list-render";
import {
  categoriesInFile,
  isCatalogueSection,
  readCatalogueCsv,
  type ImportCandidate,
} from "../lib/catalogue-import";

/**
 * The director's side of the storefront: the tooling, not the catalogue.
 *
 * Nothing in this file creates an item, a category or a price on a home's
 * behalf. A new home's storefront is empty, exactly as the vendor directory
 * and the hymn library are empty, and for a better reason than either: what
 * a home sells and what it charges is its margin and its own Funeral Rule
 * disclosure, and a supplier of software has no business having an opinion
 * about either.
 *
 * What is here is the means to load it quickly — the spreadsheet import is
 * the feature, because the alternative is a director typing two hundred
 * caskets into a web form, which is the afternoon they decide this software
 * is not worth it — and to print it in the three shapes the Rule requires.
 */

const router: IRouter = Router();

/** Price sheets are text. A few megabytes is an enormous one. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/* ------------------------------------------------------------- settings -- */

router.get("/storefront/settings", async (req, res) => {
  const home = tenant(req);
  res.json(toSettingsJson(await settingsFor(home.id)));
});

router.put("/storefront/settings", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(UpdateStorefrontSettingsBody, req.body);
  const existing = await ensureSettings(home.id);

  /*
   * Disclosures are merged rather than replaced. The console edits one slot
   * at a time, and a PUT that dropped the other five because they were not
   * in the body would quietly strip a home's price list of the paragraphs
   * their lawyer wrote.
   */
  const disclosures = {
    ...((existing.disclosures ?? {}) as Record<string, string>),
    ...(values.disclosures ?? {}),
  };

  const [updated] = await db
    .update(storefrontSettingsTable)
    .set({
      ...(values.gplEffectiveOn === undefined
        ? {}
        : { gplEffectiveOn: values.gplEffectiveOn }),
      ...(values.disclosures === undefined ? {} : { disclosures }),
      ...(values.priceListFootnote === undefined
        ? {}
        : { priceListFootnote: values.priceListFootnote }),
      ...(values.paymentPageUrl === undefined
        ? {}
        : { paymentPageUrl: values.paymentPageUrl }),
      ...(values.paymentInstructions === undefined
        ? {}
        : { paymentInstructions: values.paymentInstructions }),
      updatedAt: new Date(),
    })
    .where(eq(storefrontSettingsTable.id, existing.id))
    .returning();

  res.json(toSettingsJson(updated!));
});

/* ------------------------------------------------------------ catalogue -- */

router.get("/catalogue", async (req, res) => {
  const home = tenant(req);
  const settings = await settingsFor(home.id);
  const tree = await catalogueFor(home.id);
  const items = tree.flatMap((block) => block.items);

  res.json({
    hasGeneralPriceList: hasGeneralPriceList(settings),
    gplEffectiveOn: settings?.gplEffectiveOn ?? null,
    categories: toCatalogueJson(tree),
    packages: (await packagesFor(home.id)).map((entry) =>
      toPackageJson(entry, items),
    ),
  });
});

async function loadCategory(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CatalogueCategory> {
  const home = tenant(req);

  const [row] = await db
    .select()
    .from(catalogueCategoriesTable)
    .where(
      and(
        eq(catalogueCategoriesTable.id, parseId(rawId)),
        eq(catalogueCategoriesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That category could not be found.");
}

async function loadItem(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CatalogueItem> {
  const home = tenant(req);

  const [row] = await db
    .select()
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.id, parseId(rawId)),
        eq(catalogueItemsTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That item could not be found.");
}

async function loadPackage(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CataloguePackage> {
  const home = tenant(req);

  const [row] = await db
    .select()
    .from(cataloguePackagesTable)
    .where(
      and(
        eq(cataloguePackagesTable.id, parseId(rawId)),
        eq(cataloguePackagesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That package could not be found.");
}

/** Append after whatever the home already has in that place. */
async function nextPosition(
  table:
    | typeof catalogueCategoriesTable
    | typeof catalogueItemsTable
    | typeof cataloguePackagesTable,
  where: ReturnType<typeof and>,
): Promise<number> {
  const [row] = await db
    .select({ value: sql<number | null>`max(${table.position})` })
    .from(table)
    .where(where);

  return (row?.value ?? -1) + 1;
}

router.post("/catalogue/categories", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreateCategoryBody, req.body);

  const [created] = await db
    .insert(catalogueCategoriesTable)
    .values({
      funeralHomeId: home.id,
      name: values.name,
      description: values.description ?? null,
      section: values.section,
      position: await nextPosition(
        catalogueCategoriesTable,
        and(
          eq(catalogueCategoriesTable.funeralHomeId, home.id),
          eq(catalogueCategoriesTable.section, values.section),
        ),
      ),
    })
    .returning();

  res.status(201).json({ ...toCategoryJson(created!), items: [] });
});

router.put("/catalogue/categories/:categoryId", async (req, res) => {
  const existing = await loadCategory(req, req.params.categoryId);
  const { archived, ...values } = parseBody(UpdateCategoryBody, req.body);

  const [updated] = await db
    .update(catalogueCategoriesTable)
    .set({
      ...values,
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(catalogueCategoriesTable.id, existing.id))
    .returning();

  res.json(toCategoryJson(updated!));
});

/**
 * Deleting rather than archiving, and only while nothing has been sold from
 * it.
 *
 * A category a family has chosen from is part of a statement, and a
 * statement is a document the home handed across a desk. So the moment one
 * of its items appears on any selection, "delete" becomes "archive" and the
 * rows stay where they are. A director who is clearing up a typo on the
 * afternoon they loaded the catalogue gets the delete they expect.
 */
router.delete("/catalogue/categories/:categoryId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadCategory(req, req.params.categoryId);

  const sold = await db
    .select({ id: merchandiseSelectionItemsTable.id })
    .from(merchandiseSelectionItemsTable)
    .innerJoin(
      catalogueItemsTable,
      eq(merchandiseSelectionItemsTable.catalogueItemId, catalogueItemsTable.id),
    )
    .where(
      and(
        eq(merchandiseSelectionItemsTable.funeralHomeId, home.id),
        eq(catalogueItemsTable.categoryId, existing.id),
      ),
    )
    .limit(1);

  if (sold.length > 0) {
    await db
      .update(catalogueCategoriesTable)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(catalogueCategoriesTable.id, existing.id));

    res.json({ archived: true });
    return;
  }

  await db
    .delete(catalogueCategoriesTable)
    .where(eq(catalogueCategoriesTable.id, existing.id));

  res.status(204).end();
});

router.post("/catalogue/items", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreateItemBody, req.body);

  const category = await loadCategory(req, String(values.categoryId));
  await assertOwnUpload(home.id, values.photoUploadId ?? null);

  const [created] = await db
    .insert(catalogueItemsTable)
    .values({
      funeralHomeId: home.id,
      categoryId: category.id,
      name: values.name,
      description: values.description ?? null,
      itemCode: values.itemCode ?? null,
      priceCents: values.priceCents,
      priceUnit: values.priceUnit ?? null,
      photoUploadId: values.photoUploadId ?? null,
      availability: values.availability ?? "available",
      position: await nextPosition(
        catalogueItemsTable,
        eq(catalogueItemsTable.categoryId, category.id),
      ),
    })
    .returning();

  res.status(201).json(toItemJson(created!));
});

router.put("/catalogue/items/:itemId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadItem(req, req.params.itemId);
  const { archived, categoryId, ...values } = parseBody(
    UpdateItemBody,
    req.body,
  );

  if (categoryId !== undefined) await loadCategory(req, String(categoryId));
  if (values.photoUploadId !== undefined) {
    await assertOwnUpload(home.id, values.photoUploadId);
  }

  const [updated] = await db
    .update(catalogueItemsTable)
    .set({
      ...values,
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(catalogueItemsTable.id, existing.id))
    .returning();

  res.json(toItemJson(updated!));
});

router.delete("/catalogue/items/:itemId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadItem(req, req.params.itemId);

  const [sold] = await db
    .select({ id: merchandiseSelectionItemsTable.id })
    .from(merchandiseSelectionItemsTable)
    .where(
      and(
        eq(merchandiseSelectionItemsTable.funeralHomeId, home.id),
        eq(merchandiseSelectionItemsTable.catalogueItemId, existing.id),
      ),
    )
    .limit(1);

  if (sold) {
    await db
      .update(catalogueItemsTable)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(catalogueItemsTable.id, existing.id));

    res.json({ archived: true });
    return;
  }

  await db.delete(catalogueItemsTable).where(eq(catalogueItemsTable.id, existing.id));
  res.status(204).end();
});

/**
 * A photograph has to belong to the home that is attaching it.
 *
 * The upload id arrives in the request body, which makes it the one number
 * in this file an attacker chooses. Without this check a home could point an
 * item at another home's upload and pull the bytes back out through its own
 * catalogue.
 */
async function assertOwnUpload(
  funeralHomeId: number,
  uploadId: number | null,
): Promise<void> {
  if (uploadId === null) return;

  const [row] = await db
    .select({ id: uploadsTable.id })
    .from(uploadsTable)
    .where(
      and(eq(uploadsTable.id, uploadId), eq(uploadsTable.funeralHomeId, funeralHomeId)),
    )
    .limit(1);

  if (!row) throw badRequest("That photograph could not be found.");
}

/* ------------------------------------------------------------- packages -- */

/** Every id has to be one of this home's live items, or the package lies. */
async function ownItems(
  funeralHomeId: number,
  itemIds: readonly number[],
): Promise<CatalogueItem[]> {
  const unique = [...new Set(itemIds)];

  const rows = await db
    .select()
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.funeralHomeId, funeralHomeId),
        inArray(catalogueItemsTable.id, unique),
        isNull(catalogueItemsTable.archivedAt),
      ),
    );

  if (rows.length !== unique.length) {
    throw badRequest("One of those items is no longer in your catalogue.");
  }

  return rows;
}

router.post("/catalogue/packages", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreatePackageBody, req.body);
  const items = await ownItems(home.id, values.itemIds);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(cataloguePackagesTable)
      .values({
        funeralHomeId: home.id,
        name: values.name,
        description: values.description ?? null,
        priceCents: values.priceCents,
        position: await nextPosition(
          cataloguePackagesTable,
          eq(cataloguePackagesTable.funeralHomeId, home.id),
        ),
      })
      .returning();

    await tx.insert(cataloguePackageItemsTable).values(
      items.map((item) => ({
        funeralHomeId: home.id,
        packageId: row!.id,
        itemId: item.id,
      })),
    );

    return row!;
  });

  res.status(201).json(
    toPackageJson({ package: created, itemIds: items.map((i) => i.id) }, items),
  );
});

router.put("/catalogue/packages/:packageId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPackage(req, req.params.packageId);
  const { archived, itemIds, ...values } = parseBody(UpdatePackageBody, req.body);

  const items = itemIds ? await ownItems(home.id, itemIds) : null;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(cataloguePackagesTable)
      .set({
        ...values,
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(cataloguePackagesTable.id, existing.id))
      .returning();

    if (items) {
      await tx
        .delete(cataloguePackageItemsTable)
        .where(eq(cataloguePackageItemsTable.packageId, existing.id));

      await tx.insert(cataloguePackageItemsTable).values(
        items.map((item) => ({
          funeralHomeId: home.id,
          packageId: existing.id,
          itemId: item.id,
        })),
      );
    }

    return row!;
  });

  const members = items ?? (await ownItems(home.id, await memberIds(existing.id)));

  res.json(
    toPackageJson(
      { package: updated, itemIds: members.map((item) => item.id) },
      members,
    ),
  );
});

async function memberIds(packageId: number): Promise<number[]> {
  const rows = await db
    .select({ itemId: cataloguePackageItemsTable.itemId })
    .from(cataloguePackageItemsTable)
    .where(eq(cataloguePackageItemsTable.packageId, packageId));

  return rows.map((row) => row.itemId);
}

/**
 * Withdrawing a package.
 *
 * Deleted while nobody has chosen it; archived once somebody has, and the
 * distinction is not tidiness. A selection's lines point back at the package
 * they came from, and that link is what lets declining one of its items take
 * the package's price adjustment with it. Hard-deleting the row would null
 * those links and leave a family holding a discount for a set they had
 * already broken — a total that quietly stopped adding up, on the one screen
 * where it must.
 */
router.delete("/catalogue/packages/:packageId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPackage(req, req.params.packageId);

  const [chosen] = await db
    .select({ id: merchandiseSelectionItemsTable.id })
    .from(merchandiseSelectionItemsTable)
    .where(
      and(
        eq(merchandiseSelectionItemsTable.funeralHomeId, home.id),
        eq(merchandiseSelectionItemsTable.packageId, existing.id),
      ),
    )
    .limit(1);

  if (chosen) {
    await db
      .update(cataloguePackagesTable)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(cataloguePackagesTable.id, existing.id));

    res.json({ archived: true });
    return;
  }

  await db
    .delete(cataloguePackagesTable)
    .where(eq(cataloguePackagesTable.id, existing.id));

  res.status(204).end();
});

/* --------------------------------------------------------------- import -- */

function readFile(file: Express.Multer.File | undefined): string {
  if (!file?.buffer?.length) {
    throw badRequest("Please choose a price list to load.");
  }

  const parsed = file.buffer.toString("utf8");
  if (parsed.trim() === "") throw badRequest("That file is empty.");

  return parsed;
}

/**
 * What the file would do, before it does it.
 *
 * Two steps rather than one, for the same reason the case importer has two:
 * the failure mode is two hundred wrong prices in front of a family and
 * there is no undo for a conversation. The preview is also where the
 * director tells us which of their own category names are caskets — we
 * guess, and guessing wrong puts a vault on the Casket Price List.
 */
router.post("/catalogue/import/preview", upload.single("file"), async (req, res) => {
  const home = tenant(req);
  const parsed = readCatalogueCsv(readFile(req.file));

  const existing = await db
    .select({
      itemCode: catalogueItemsTable.itemCode,
      name: catalogueItemsTable.name,
    })
    .from(catalogueItemsTable)
    .where(eq(catalogueItemsTable.funeralHomeId, home.id));

  const codes = new Set(
    existing.map((row) => row.itemCode).filter((code): code is string => !!code),
  );

  const issues = [...parsed.issues];

  if (!parsed.mapping["name"]) {
    issues.unshift({
      row: 1,
      message:
        'No item-name column recognised. Rename one column to "Name" and try again.',
    });
  }
  if (!parsed.mapping["priceCents"]) {
    issues.unshift({
      row: 1,
      message:
        'No price column recognised. Rename one column to "Price" and try again. ' +
        "Cost and wholesale columns are ignored on purpose.",
    });
  }

  const wouldUpdate = parsed.candidates.filter(
    (candidate) => candidate.itemCode && codes.has(candidate.itemCode),
  ).length;

  res.json({
    headers: parsed.headers,
    mapping: parsed.mapping,
    totalRows: parsed.totalRows,
    categories: categoriesInFile(parsed.candidates),
    wouldCreate: parsed.candidates.length - wouldUpdate,
    wouldUpdate,
    // Twenty is plenty to see that the columns landed in the right places.
    rows: parsed.candidates.slice(0, 20),
    issues,
  });
});

/**
 * Where the home's sections come from on the way in.
 *
 * The director corrected them in the preview and sends the map back; a
 * category they did not touch keeps the guess. Anything unrecognised is
 * refused rather than defaulted, because silently filing a casket under
 * merchandise would take it off the Casket Price List.
 */
function sectionsFromBody(body: unknown): Record<string, string> {
  const raw = (body as { sections?: unknown } | undefined)?.sections;
  if (raw === undefined) return {};

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest("Could not read which price list each category is on.");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw badRequest("Could not read which price list each category is on.");
  }

  const out: Record<string, string> = {};
  for (const [name, section] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof section !== "string" || !isCatalogueSection(section)) {
      throw badRequest(`"${section}" is not one of the price lists.`);
    }
    out[name] = section;
  }

  return out;
}

router.post("/catalogue/import", upload.single("file"), async (req, res) => {
  const home = tenant(req);
  const parsed = readCatalogueCsv(readFile(req.file));
  const chosen = sectionsFromBody(req.body);

  if (!parsed.mapping["name"] || !parsed.mapping["priceCents"]) {
    throw badRequest(
      'That file needs a name column and a price column. Rename them to "Name" and "Price" and try again.',
    );
  }

  if (parsed.candidates.length === 0) {
    throw badRequest(
      "Nothing in that file could be read as a priced item. The issues from the preview say why.",
    );
  }

  const issues = [...parsed.issues];
  let created = 0;
  let updated = 0;

  const fileCategories = categoriesInFile(parsed.candidates);

  await db.transaction(async (tx) => {
    const categoryIds = new Map<string, number>();

    for (const entry of fileCategories) {
      const section = chosen[entry.name] ?? entry.section;

      const [existing] = await tx
        .select()
        .from(catalogueCategoriesTable)
        .where(
          and(
            eq(catalogueCategoriesTable.funeralHomeId, home.id),
            eq(catalogueCategoriesTable.name, entry.name),
          ),
        )
        .limit(1);

      if (existing) {
        // Re-importing must not resurrect a category the home retired, and
        // must not silently move one onto a different price list either.
        await tx
          .update(catalogueCategoriesTable)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(catalogueCategoriesTable.id, existing.id));

        categoryIds.set(entry.name, existing.id);
        continue;
      }

      const [row] = await tx
        .insert(catalogueCategoriesTable)
        .values({
          funeralHomeId: home.id,
          name: entry.name,
          section,
          position: fileCategories.indexOf(entry),
        })
        .returning();

      categoryIds.set(entry.name, row!.id);
    }

    for (const [index, candidate] of parsed.candidates.entries()) {
      const categoryId = categoryIds.get(candidate.categoryName)!;

      try {
        const existing = await findExisting(tx, home.id, candidate);

        if (existing) {
          await tx
            .update(catalogueItemsTable)
            .set({
              categoryId,
              name: candidate.name,
              description: candidate.description,
              priceCents: candidate.priceCents,
              priceUnit: candidate.priceUnit,
              availability: candidate.availability,
              archivedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(catalogueItemsTable.id, existing.id));

          updated += 1;
          continue;
        }

        await tx.insert(catalogueItemsTable).values({
          funeralHomeId: home.id,
          categoryId,
          name: candidate.name,
          description: candidate.description,
          itemCode: candidate.itemCode,
          priceCents: candidate.priceCents,
          priceUnit: candidate.priceUnit,
          availability: candidate.availability,
          position: index,
        });

        created += 1;
      } catch (error) {
        issues.push({
          row: candidate.row,
          message:
            error instanceof Error
              ? `Could not load "${candidate.name}": ${error.message}`
              : `Could not load "${candidate.name}".`,
        });
      }
    }
  });

  res.json({ created, updated, issues });
});

/**
 * The row this one is an update of, if any.
 *
 * By the home's own item code where there is one, and by name within the
 * same catalogue otherwise. Matching on name is looser than anyone would
 * like, and it is still right: without it, a director who drops last year's
 * sheet in again gets two of every casket, which is worse.
 */
async function findExisting(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  funeralHomeId: number,
  candidate: ImportCandidate,
): Promise<{ id: number } | undefined> {
  const [row] = await tx
    .select({ id: catalogueItemsTable.id })
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.funeralHomeId, funeralHomeId),
        candidate.itemCode
          ? eq(catalogueItemsTable.itemCode, candidate.itemCode)
          : eq(catalogueItemsTable.name, candidate.name),
      ),
    )
    .limit(1);

  return row;
}

/* --------------------------------------------------------- the price lists */

const PRICE_LIST_KINDS: readonly PriceListKind[] = ["gpl", "cpl", "obcpl"];

function readKind(raw: string | undefined): PriceListKind {
  if (!raw || !(PRICE_LIST_KINDS as readonly string[]).includes(raw)) {
    throw badRequest("That is not one of the price lists.");
  }
  return raw as PriceListKind;
}

/**
 * The General, Casket and Outer Burial Container price lists, as printable
 * sheets.
 *
 * Shared with the family surface, which renders exactly the same document
 * from exactly the same function — a family and a director looking at two
 * different price lists is the bug this component exists to make impossible.
 */
export async function renderPriceListFor(
  funeralHomeId: number,
  home: Parameters<typeof renderPriceList>[0]["home"],
  kind: PriceListKind,
): Promise<string> {
  const settings = await settingsFor(funeralHomeId);
  const categories = await priceListCategories(funeralHomeId, kind);

  if (categories.length === 0) {
    throw badRequest(
      kind === "gpl"
        ? "There is nothing in your catalogue yet, so there is no price list to print."
        : kind === "cpl"
          ? "You have no caskets in your catalogue, so there is no Casket Price List to print."
          : "You have no outer burial containers in your catalogue, so there is no list to print.",
    );
  }

  return renderPriceList({
    kind,
    home,
    settings,
    categories,
    logoDataUri: await dataUri(home.logoUploadId),
  });
}

export function sendPrintable(res: Response, html: string): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // One home's prices, rendered for one reader: never cached by a proxy.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(html);
}

router.get("/catalogue/price-lists/:kind/render", async (req, res) => {
  const home = tenant(req);
  const kind = readKind(req.params.kind);

  sendPrintable(res, await renderPriceListFor(home.id, home, kind));
});

export default router;
