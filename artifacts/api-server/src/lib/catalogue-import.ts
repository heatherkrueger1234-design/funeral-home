import { CATALOGUE_SECTIONS, type CatalogueSection } from "@workspace/db";
import { normaliseHeader, parseCsv, type CsvRow } from "./csv";

/**
 * Reading the spreadsheet the home already has.
 *
 * Every funeral home on earth has its merchandise in a file somewhere — a
 * supplier's price sheet, a tab in the workbook the owner has kept since
 * 2004, an export from whatever the selection room runs on. Nobody is going
 * to retype two hundred caskets into a web form, and a product that asks
 * them to is a product the director quietly stops opening.
 *
 * So this reads their file rather than asking for ours. The CSV scanner in
 * `csv.ts` already handles what Excel does to a file on the way out — the
 * BOM, the CRLFs, the quoted commas — and this adds the part that is
 * specific to a price list: which column is the price, and which statutory
 * list each of the home's own category names belongs on.
 *
 * Two endpoints use it, and the second one never runs without the first:
 * the preview shows what would be created and the director corrects it. The
 * failure mode of a bad catalogue import is two hundred wrong prices in
 * front of a family, and there is no undo for a conversation.
 */

/** What each of our fields might be called in somebody else's price sheet. */
export const CATALOGUE_COLUMN_ALIASES: Record<string, readonly string[]> = {
  category: [
    "category", "categoryname", "group", "grouping", "producttype", "type",
    "department", "class", "collection",
  ],
  name: [
    "name", "item", "itemname", "product", "productname", "model", "modelname",
    "title", "casket", "description1",
  ],
  description: [
    "description", "details", "detail", "specification", "specifications",
    "spec", "specs", "materials", "material", "construction", "interior",
    "longdescription", "notes", "comments",
  ],
  /**
   * Deliberately not "cost", "wholesale" or "ourcost".
   *
   * Those columns are in half the sheets a home will drop in here, they sit
   * right beside the retail column, and importing one would publish a home's
   * margin to the family reading the price list. A director who genuinely
   * has only a cost column can rename it, which takes ten seconds and is a
   * decision they have made on purpose.
   */
  priceCents: [
    "price", "retail", "retailprice", "listprice", "sellingprice", "priceeach",
    "unitprice", "amount", "charge", "fee", "priceusd",
  ],
  itemCode: [
    "code", "itemcode", "sku", "modelnumber", "modelno", "itemnumber",
    "itemno", "productcode", "partnumber", "stocknumber",
  ],
  priceUnit: ["unit", "priceunit", "per", "uom", "basis"],
  availability: ["availability", "available", "stock", "status", "instock"],
};

/** Guess which incoming column feeds which of our fields. */
export function guessCatalogueMapping(
  headers: string[],
): Record<string, string | null> {
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, string | null> = {};

  for (const [field, aliases] of Object.entries(CATALOGUE_COLUMN_ALIASES)) {
    const index = normalised.findIndex((header) => aliases.includes(header));
    mapping[field] = index === -1 ? null : headers[index]!;
  }

  return mapping;
}

/**
 * A price, from whatever a spreadsheet put in the cell.
 *
 * Parsed as two integers rather than with `parseFloat`, because the result
 * is added to other prices and printed on a document the Rule requires to be
 * accurate, and `0.1 + 0.2` is the reason nobody sane holds money in a
 * float. Returns null rather than guessing: a price that cannot be read is
 * reported on the row it came from, and the item is left out.
 */
export function parsePriceCents(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;

  // Accounting exports wrap negatives in brackets. A negative price is not a
  // thing we can print, so it is rejected rather than flipped.
  if (/^\(.*\)$/.test(value) || value.startsWith("-")) return null;

  const cleaned = value.replace(/[$\s,]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");

  if (!Number.isSafeInteger(dollars)) return null;
  return dollars * 100 + cents;
}

/**
 * Which statutory list a category the home named belongs on.
 *
 * A guess, shown in the preview and changed with one control per category
 * before anything is written. It has to be a guess because the column says
 * "Traditional Series" and the Funeral Rule wants to know whether that is a
 * casket; and it has to be correctable because guessing wrong puts a vault
 * on the Casket Price List.
 *
 * Defaults to `merchandise` rather than to nothing, because merchandise is
 * the section that appears on the General Price List alone — the guess that
 * is wrong in the safe direction, since it under-discloses nothing and
 * cannot smuggle a casket onto a list that is not shown until the GPL is.
 */
export function guessSection(categoryName: string): CatalogueSection {
  const text = categoryName.toLowerCase();

  if (/\b(vault|liner|outer burial|burial container|grave box)/.test(text)) {
    return "outer_burial_containers";
  }
  if (/\b(casket|coffin|alternative container|cremation container)/.test(text)) {
    return "caskets";
  }
  if (
    /\b(service|staff|facilit|transfer|transport|hearse|coach|limousine|embalm|cremation fee|direct cremation|graveside|viewing|visitation|shelter|professional)/.test(
      text,
    )
  ) {
    return "services";
  }
  if (/\b(cash advance|disbursement|third party|advance item|permit|certified cop|obituary notice)/.test(text)) {
    return "cash_advance";
  }

  return "merchandise";
}

export function isCatalogueSection(value: string): value is CatalogueSection {
  return (CATALOGUE_SECTIONS as readonly string[]).includes(value);
}

export type ImportIssue = { row: number; message: string };

export type ImportCandidate = {
  row: number;
  categoryName: string;
  name: string;
  description: string | null;
  priceCents: number;
  itemCode: string | null;
  priceUnit: string | null;
  availability: "available" | "by_request";
};

export type ParsedCatalogueFile = {
  headers: string[];
  mapping: Record<string, string | null>;
  totalRows: number;
  candidates: ImportCandidate[];
  issues: ImportIssue[];
};

/**
 * "Y", "yes", "in stock", "special order", "by request", blank.
 *
 * Anything that reads like an order-in becomes `by_request`; everything else
 * is available. Deliberately not a third state for "discontinued": a home
 * that no longer sells something leaves it out of the file, and an importer
 * that quietly kept selling it would be worse than one that did not.
 */
function readAvailability(raw: string): "available" | "by_request" {
  const value = raw.trim().toLowerCase();
  if (value === "") return "available";
  return /(request|order|special|indent|not in stock|out of stock|n\/a|no)/.test(
    value,
  )
    ? "by_request"
    : "available";
}

export function readCatalogueCsv(text: string): ParsedCatalogueFile {
  const parsed = parseCsv(text);
  const mapping = guessCatalogueMapping(parsed.headers);

  const get = (row: CsvRow, field: string): string => {
    const header = mapping[field];
    if (!header) return "";
    return row[normaliseHeader(header)] ?? "";
  };

  const candidates: ImportCandidate[] = [];
  const issues: ImportIssue[] = [];

  parsed.rows.forEach((row, index) => {
    // The line number a spreadsheet shows, so "row 34" means row 34.
    const lineNumber = index + 2;

    const name = get(row, "name").trim();
    const rawPrice = get(row, "priceCents").trim();

    if (!name) {
      // A genuinely blank row is Excel padding, not something to report.
      if (Object.values(row).some((value) => value !== "")) {
        issues.push({ row: lineNumber, message: "No item name in this row." });
      }
      return;
    }

    if (!rawPrice) {
      issues.push({
        row: lineNumber,
        message: `"${name}" has no price, so it was left out. Every item on a price list needs one.`,
      });
      return;
    }

    const priceCents = parsePriceCents(rawPrice);

    if (priceCents === null) {
      issues.push({
        row: lineNumber,
        message: `Couldn't read the price "${rawPrice}" for "${name}", so it was left out.`,
      });
      return;
    }

    const categoryName = get(row, "category").trim() || "Uncategorised";

    candidates.push({
      row: lineNumber,
      categoryName,
      name: name.slice(0, 200),
      description: get(row, "description").trim().slice(0, 2000) || null,
      priceCents,
      itemCode: get(row, "itemCode").trim().slice(0, 100) || null,
      priceUnit: get(row, "priceUnit").trim().slice(0, 40) || null,
      availability: readAvailability(get(row, "availability")),
    });
  });

  return {
    headers: parsed.headers,
    mapping,
    totalRows: parsed.rows.length,
    candidates,
    issues,
  };
}

/** The distinct categories in a file, in the order they first appear. */
export function categoriesInFile(
  candidates: readonly ImportCandidate[],
): { name: string; section: CatalogueSection; itemCount: number }[] {
  const seen = new Map<string, { name: string; section: CatalogueSection; itemCount: number }>();

  for (const candidate of candidates) {
    const existing = seen.get(candidate.categoryName);
    if (existing) {
      existing.itemCount += 1;
      continue;
    }
    seen.set(candidate.categoryName, {
      name: candidate.categoryName,
      section: guessSection(candidate.categoryName),
      itemCount: 1,
    });
  }

  return [...seen.values()];
}
