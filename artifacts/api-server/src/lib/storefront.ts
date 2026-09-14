import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  AddFamilyProvidedItemBody,
  UpdateMerchandiseSelectionBody,
  UpdateSelectionLineBody,
} from "@workspace/api-zod";
import {
  db,
  uploadsTable,
  catalogueCategoriesTable,
  catalogueItemsTable,
  cataloguePackageItemsTable,
  cataloguePackagesTable,
  merchandiseSelectionItemsTable,
  merchandiseSelectionsTable,
  storefrontSettingsTable,
  CATALOGUE_SECTIONS,
  GPL_DISCLOSURES,
  SECTIONS_BEHIND_THE_GPL,
  hasGeneralPriceList,
  lineTotalCents,
  selectionTotalCents,
  type CatalogueCategory,
  type CatalogueItem,
  type CataloguePackage,
  type MerchandiseSelection,
  type MerchandiseSelectionItem,
  type StorefrontSettings,
} from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import { badRequest, parseBody } from "./http";
import type { PriceListCategory, PriceListKind } from "./price-list-render";

/**
 * The storefront's shared reading and writing, in one place.
 *
 * Both routers below it — the director's catalogue and the family's
 * browsing — ask the same three questions: what is this home selling, has
 * this home got a General Price List yet, and what has this family chosen.
 * Answering them twice is how the two sides end up disagreeing about a
 * total, which is the one bug in this component a family would actually
 * notice.
 *
 * The request bodies come from `openapi.yaml` under the `catalogue` and
 * `orders` tags, like every other surface in this API. Read `assertNoExtraKeys`
 * below before adding one: the generator drops an unknown key where the spec
 * says to refuse it, and on this component's no-fee path that difference is
 * the whole point.
 */

/* --------------------------------------------------------------- bodies -- */

/**
 * The request bodies, generated from `openapi.yaml` — with one thing put
 * back by hand.
 *
 * Orval does not carry `additionalProperties: false` through to `.strict()`,
 * so a generated validator *drops* an unknown key rather than refusing it.
 * For most bodies that is the behaviour we want and `parseBody` says so. For
 * the three below it is not, and the one that matters is
 * `FamilyProvidedInput`: a client attaching a fee to a third-party casket
 * must be told no, not quietly ignored, because the difference between
 * "refused" and "silently dropped" is the difference between a rule the
 * product enforces and a rule it merely happens to obey today.
 *
 * So the spec says `additionalProperties: false`, which is the contract, and
 * this re-applies it, which is the enforcement. If orval ever learns to emit
 * `.strict()`, delete this and the schemas below become the whole story.
 */
function assertNoExtraKeys(
  body: unknown,
  allowed: readonly string[],
  what: string,
): void {
  if (!body || typeof body !== "object") return;

  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return;

  throw badRequest(`${what} does not take ${extra.join(", ")}.`);
}

/**
 * "We are bringing our own", and the only fields it will ever accept.
 *
 * A funeral provider may not refuse a casket or urn a family bought
 * elsewhere and may not charge a handling fee for one. The surest way to
 * keep a fee out of a product is to build nowhere to put one — so there is
 * no price column reachable from this path, no price in this body, and a
 * request that invents one is refused rather than trimmed.
 */
const FAMILY_PROVIDED_KEYS = ["name", "notes"] as const;
const SELECTION_LINE_KEYS = ["quantity", "notes"] as const;
const SELECTION_KEYS = [
  "notes",
  "confirmed",
  "settled",
  "settledNote",
] as const;

export function parseFamilyProvided(
  body: unknown,
): z.infer<typeof AddFamilyProvidedItemBody> {
  assertNoExtraKeys(body, FAMILY_PROVIDED_KEYS, "Bringing your own");
  return parseBody(AddFamilyProvidedItemBody, body);
}

export function parseSelectionLineUpdate(
  body: unknown,
): z.infer<typeof UpdateSelectionLineBody> {
  assertNoExtraKeys(body, SELECTION_LINE_KEYS, "That change");
  return parseBody(UpdateSelectionLineBody, body);
}

export function parseSelectionUpdate(
  body: unknown,
): z.infer<typeof UpdateMerchandiseSelectionBody> {
  assertNoExtraKeys(body, SELECTION_KEYS, "That change");
  return parseBody(UpdateMerchandiseSelectionBody, body);
}

/**
 * An empty box is an empty box.
 *
 * A textarea that has been cleared sends `""`, and storing that rather than
 * null means "is there a footnote" answers yes to nothing at all. The spec
 * cannot express it, so it is normalised once here rather than at each of
 * the dozen call sites that would otherwise have to remember.
 */
export function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/* ---------------------------------------------------------- the settings -- */

export async function settingsFor(
  funeralHomeId: number,
): Promise<StorefrontSettings | null> {
  const [row] = await db
    .select()
    .from(storefrontSettingsTable)
    .where(eq(storefrontSettingsTable.funeralHomeId, funeralHomeId))
    .limit(1);

  return row ?? null;
}

/** The settings row, created empty on first write. Never pre-filled. */
export async function ensureSettings(
  funeralHomeId: number,
): Promise<StorefrontSettings> {
  const existing = await settingsFor(funeralHomeId);
  if (existing) return existing;

  const [created] = await db
    .insert(storefrontSettingsTable)
    .values({ funeralHomeId })
    .onConflictDoNothing()
    .returning();

  // A concurrent first write won the insert; its row is the one that counts.
  return created ?? (await settingsFor(funeralHomeId))!;
}

export function toSettingsJson(
  settings: StorefrontSettings | null,
): Record<string, unknown> {
  return {
    gplEffectiveOn: settings?.gplEffectiveOn ?? null,
    hasGeneralPriceList: hasGeneralPriceList(settings),
    disclosures: (settings?.disclosures ?? {}) as Record<string, string>,
    priceListFootnote: settings?.priceListFootnote ?? null,
    paymentPageUrl: settings?.paymentPageUrl ?? null,
    paymentInstructions: settings?.paymentInstructions ?? null,
    /** So the console can name the slots without shipping the list twice. */
    disclosureSlots: GPL_DISCLOSURES,
  };
}

/* --------------------------------------------------------- the catalogue -- */

export type CatalogueTree = {
  category: CatalogueCategory;
  items: CatalogueItem[];
}[];

/** The order the sections print and browse in. The Rule's order, not ours. */
const SECTION_ORDER: readonly string[] = [
  "services",
  "caskets",
  "outer_burial_containers",
  "merchandise",
  "cash_advance",
];

function bySection(a: CatalogueCategory, b: CatalogueCategory): number {
  const rank =
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
  if (rank !== 0) return rank;
  if (a.position !== b.position) return a.position - b.position;
  return a.id - b.id;
}

export async function catalogueFor(
  funeralHomeId: number,
  options: { includeArchived?: boolean; sections?: readonly string[] } = {},
): Promise<CatalogueTree> {
  const categories = await db
    .select()
    .from(catalogueCategoriesTable)
    .where(
      and(
        eq(catalogueCategoriesTable.funeralHomeId, funeralHomeId),
        options.includeArchived
          ? undefined
          : isNull(catalogueCategoriesTable.archivedAt),
        options.sections
          ? inArray(catalogueCategoriesTable.section, [...options.sections])
          : undefined,
      ),
    );

  if (categories.length === 0) return [];

  const items = await db
    .select()
    .from(catalogueItemsTable)
    .where(
      and(
        eq(catalogueItemsTable.funeralHomeId, funeralHomeId),
        inArray(
          catalogueItemsTable.categoryId,
          categories.map((row) => row.id),
        ),
        options.includeArchived ? undefined : isNull(catalogueItemsTable.archivedAt),
      ),
    )
    .orderBy(asc(catalogueItemsTable.position), asc(catalogueItemsTable.id));

  return categories.sort(bySection).map((category) => ({
    category,
    items: items.filter((item) => item.categoryId === category.id),
  }));
}

export function toCategoryJson(category: CatalogueCategory) {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    section: category.section,
    position: category.position,
    archivedAt: category.archivedAt,
  };
}

export function toItemJson(item: CatalogueItem) {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    itemCode: item.itemCode,
    priceCents: item.priceCents,
    priceUnit: item.priceUnit,
    photoUploadId: item.photoUploadId,
    availability: item.availability,
    position: item.position,
    archivedAt: item.archivedAt,
  };
}

export function toCatalogueJson(tree: CatalogueTree) {
  return tree.map((block) => ({
    ...toCategoryJson(block.category),
    items: block.items.map(toItemJson),
  }));
}

/* ----------------------------------------------------------- the packages -- */

export type PackageWithItems = {
  package: CataloguePackage;
  itemIds: number[];
};

export async function packagesFor(
  funeralHomeId: number,
): Promise<PackageWithItems[]> {
  const packages = await db
    .select()
    .from(cataloguePackagesTable)
    .where(
      and(
        eq(cataloguePackagesTable.funeralHomeId, funeralHomeId),
        isNull(cataloguePackagesTable.archivedAt),
      ),
    )
    .orderBy(asc(cataloguePackagesTable.position), asc(cataloguePackagesTable.id));

  if (packages.length === 0) return [];

  const members = await db
    .select()
    .from(cataloguePackageItemsTable)
    .where(
      inArray(
        cataloguePackageItemsTable.packageId,
        packages.map((row) => row.id),
      ),
    )
    .orderBy(asc(cataloguePackageItemsTable.id));

  return packages.map((row) => ({
    package: row,
    itemIds: members
      .filter((member) => member.packageId === row.id)
      .map((member) => member.itemId),
  }));
}

/**
 * A package as both sides read it.
 *
 * `itemisedTotalCents` is always alongside `priceCents`, never instead of
 * it. A family looking at a package has to be able to see what the same
 * things cost bought one at a time, or the package is the only price on
 * offer — which is the thing the Funeral Rule actually forbids.
 */
export function toPackageJson(
  entry: PackageWithItems,
  items: readonly CatalogueItem[],
) {
  const members = entry.itemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is CatalogueItem => item !== undefined);

  const itemisedTotalCents = members.reduce(
    (total, item) => total + item.priceCents,
    0,
  );

  return {
    id: entry.package.id,
    name: entry.package.name,
    description: entry.package.description,
    priceCents: entry.package.priceCents,
    itemisedTotalCents,
    items: members.map(toItemJson),
  };
}

/* --------------------------------------------------------- the selection -- */

export type SelectionWithLines = {
  selection: MerchandiseSelection;
  lines: MerchandiseSelectionItem[];
};

export async function selectionFor(
  caseId: number,
  funeralHomeId: number,
): Promise<SelectionWithLines | null> {
  const [selection] = await db
    .select()
    .from(merchandiseSelectionsTable)
    .where(
      and(
        eq(merchandiseSelectionsTable.caseId, caseId),
        eq(merchandiseSelectionsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (!selection) return null;

  return { selection, lines: await linesFor(selection.id) };
}

export async function linesFor(
  selectionId: number,
): Promise<MerchandiseSelectionItem[]> {
  return db
    .select()
    .from(merchandiseSelectionItemsTable)
    .where(eq(merchandiseSelectionItemsTable.selectionId, selectionId))
    .orderBy(
      asc(merchandiseSelectionItemsTable.position),
      asc(merchandiseSelectionItemsTable.id),
    );
}

/** The selection for this case, created empty the first time it is needed. */
export async function ensureSelection(
  caseId: number,
  funeralHomeId: number,
): Promise<SelectionWithLines> {
  const existing = await selectionFor(caseId, funeralHomeId);
  if (existing) return existing;

  await db
    .insert(merchandiseSelectionsTable)
    .values({ funeralHomeId, caseId })
    .onConflictDoNothing();

  return (await selectionFor(caseId, funeralHomeId))!;
}

/** Append after whatever is already on the sheet. */
export async function nextLinePosition(selectionId: number): Promise<number> {
  const [row] = await db
    .select({ value: sql<number | null>`max(${merchandiseSelectionItemsTable.position})` })
    .from(merchandiseSelectionItemsTable)
    .where(eq(merchandiseSelectionItemsTable.selectionId, selectionId));

  return (row?.value ?? -1) + 1;
}

export function toSelectionLineJson(line: MerchandiseSelectionItem) {
  return {
    id: line.id,
    kind: line.kind,
    catalogueItemId: line.catalogueItemId,
    packageId: line.packageId,
    name: line.name,
    description: line.description,
    section: line.section,
    /**
     * Null on a family-provided line, and that is the whole point: there is
     * no amount, so there is nothing for an interface to render as a fee.
     */
    unitPriceCents: line.unitPriceCents,
    quantity: line.quantity,
    lineTotalCents: lineTotalCents(line),
    notes: line.notes,
    position: line.position,
  };
}

export function toSelectionJson(entry: SelectionWithLines) {
  return {
    id: entry.selection.id,
    status: entry.selection.status,
    gplShownAt: entry.selection.gplShownAt,
    gplEffectiveOn: entry.selection.gplEffectiveOn,
    confirmedAt: entry.selection.confirmedAt,
    settledAt: entry.selection.settledAt,
    settledNote: entry.selection.settledNote,
    notes: entry.selection.notes,
    lines: entry.lines.map(toSelectionLineJson),
    totalCents: selectionTotalCents(entry.lines),
    updatedAt: entry.selection.updatedAt,
  };
}

/* ------------------------------------------------------------- the gate -- */

/**
 * Whether this family may be shown caskets yet.
 *
 * The Funeral Rule says a consumer gets the General Price List before they
 * are shown any casket, and it is the home's obligation rather than ours —
 * but a storefront that let a director skip it would be handing them the
 * violation, so the sequence is enforced on the server rather than drawn in
 * the interface and hoped for. Two things have to be true: the home has a
 * dated price list at all, and this family has been given it.
 */
export function mayShowCaskets(
  settings: StorefrontSettings | null,
  selection: MerchandiseSelection | null,
): boolean {
  return hasGeneralPriceList(settings) && selection?.gplShownAt != null;
}

/** The sections a family may browse right now. */
export function browsableSections(
  settings: StorefrontSettings | null,
  selection: MerchandiseSelection | null,
): readonly string[] {
  if (mayShowCaskets(settings, selection)) return CATALOGUE_SECTIONS;
  return CATALOGUE_SECTIONS.filter(
    (section) => !(SECTIONS_BEHIND_THE_GPL as readonly string[]).includes(section),
  );
}

export function assertMayShowCaskets(
  settings: StorefrontSettings | null,
  selection: MerchandiseSelection | null,
): void {
  if (mayShowCaskets(settings, selection)) return;

  throw badRequest(
    hasGeneralPriceList(settings)
      ? "The family needs the General Price List before they are shown caskets."
      : "This home has no General Price List yet. Set its effective date before showing anybody a casket.",
  );
}

/* ------------------------------------------------------------ the lists -- */

/** Which sections each statutory price list is made of. */
export const PRICE_LIST_SECTIONS: Record<PriceListKind, readonly string[]> = {
  gpl: CATALOGUE_SECTIONS,
  cpl: ["caskets"],
  obcpl: ["outer_burial_containers"],
};

export async function priceListCategories(
  funeralHomeId: number,
  kind: PriceListKind,
): Promise<PriceListCategory[]> {
  const tree = await catalogueFor(funeralHomeId, {
    sections: PRICE_LIST_SECTIONS[kind],
  });

  return tree
    .filter((block) => block.items.length > 0)
    .map((block) => ({ category: block.category, items: block.items }));
}

/** Bytes as a data URI, so a rendered sheet is one self-contained file. */
export async function dataUri(uploadId: number | null): Promise<string | null> {
  if (uploadId === null) return null;

  const [upload] = await db
    .select()
    .from(uploadsTable)
    .where(eq(uploadsTable.id, uploadId))
    .limit(1);

  if (!upload) return null;

  try {
    const bytes = decryptBuffer(upload.data);
    return `data:${upload.mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    // A price list with no logo on it still prints, and a director at nine
    // at night needs the sheet more than they need the letterhead.
    return null;
  }
}
