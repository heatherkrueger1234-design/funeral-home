import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { catalogueItemsTable, cataloguePackagesTable } from "./catalogue";

/**
 * What a family chose, and how the home gets paid — which is: not through us.
 *
 * Two things live here. The first is the selection: the itemised record of
 * what a family picked, at the home's prices, drafted while they think about
 * it and confirmed when the director says so. The second is the handful of
 * settings that turn that record into the two documents the FTC Funeral Rule
 * makes the *home* responsible for — its price lists and its Statement of
 * Funeral Goods and Services Selected.
 *
 * What is deliberately absent is any column that could hold money moving.
 * There is no amount paid, no deposit, no balance, no card, no processor
 * reference, no payout. We take nothing from families, we hold nothing on a
 * home's behalf, and a family who owes the home money is sent to the home's
 * own payment page at the home's own processor. The one Stripe integration
 * in this codebase is us charging the home its subscription and it is not
 * reachable from here.
 */

/**
 * The disclosures the Funeral Rule requires on a General Price List.
 *
 * The slots are ours; the words are the home's. That split is on purpose.
 * The Rule prescribes what each of these must convey and a home's counsel
 * signs off on how it is said — a national SaaS typing the paragraphs for
 * two hundred homes would be giving legal advice it is not qualified to
 * give, and a home that pasted ours would still be the one answering for it.
 *
 * What we can honestly do is make sure a director knows the slot exists
 * before they print a list without it, which is what `note` is for.
 */
export const GPL_DISCLOSURES = [
  {
    key: "right_to_select",
    title: "The right to choose only what you want",
    note: "That a family may buy individual items rather than a package, and that they will be told the price of anything the law or the home requires them to buy.",
  },
  {
    key: "basic_services_fee",
    title: "Basic services of funeral director and staff",
    note: "What this fee covers, and that it is included in the price of your funerals.",
  },
  {
    key: "embalming",
    title: "Embalming",
    note: "That embalming is not required by law except in certain cases, and that a family may choose an arrangement that does not need it.",
  },
  {
    key: "casket_price_list",
    title: "The Casket Price List",
    note: "That a complete list of caskets is available, and is shown before any casket is.",
  },
  {
    key: "outer_burial_container",
    title: "Outer burial containers",
    note: "That state law does not require one, and that a cemetery may.",
  },
  {
    key: "alternative_container",
    title: "Containers for direct cremation",
    note: "That a casket is not required for a direct cremation, and what the home will accept instead.",
  },
] as const;

export type GplDisclosureKey = (typeof GPL_DISCLOSURES)[number]["key"];

export const storefrontSettingsTable = pgTable(
  "storefront_settings",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /* --------------------------------------------------- the price list */

    /**
     * The date printed on the price lists, and the switch that turns the
     * storefront on.
     *
     * A General Price List carries an effective date, and until a home has
     * set one it has no GPL. Nothing in the family portal shows a casket
     * before this is filled in, because the Rule says a consumer sees the
     * General Price List before they are shown caskets and a storefront that
     * let a director skip that step would be handing them the violation.
     */
    gplEffectiveOn: timestamp("gpl_effective_on"),

    /** The home's own wording for each of `GPL_DISCLOSURES`, by key. */
    disclosures: jsonb("disclosures").notNull().default({}),

    /** Printed at the foot of every list. "Prices subject to change", etc. */
    priceListFootnote: text("price_list_footnote"),

    /* ------------------------------------------------------ the handoff */

    /**
     * The home's own payment page, at the home's own processor.
     *
     * A link, not an integration. Stored so the statement can end with a way
     * to pay that is visibly the home's — a message about money sent to a
     * grieving family is exactly what a scammer imitates, so the destination
     * is shown in full beside it and the family is never surprised by where
     * they land. When it is empty the statement says to ring the home and
     * gives the number, which is not an error state: plenty of homes would
     * rather take a cheque.
     */
    paymentPageUrl: text("payment_page_url"),
    /**
     * The other ways the home takes money, in the home's own words. Where
     * to post a cheque, who to ask for, which hours the office is open.
     */
    paymentInstructions: text("payment_instructions"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("storefront_settings_home_unique").on(table.funeralHomeId),
  ],
);

export const SELECTION_STATUSES = ["draft", "confirmed"] as const;
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

/**
 * One family's selection, and later their Statement.
 *
 * One row per case, because a family arranging one funeral is making one
 * set of choices; a second draft beside the first is how two people end up
 * reading different totals over the telephone.
 */
export const merchandiseSelectionsTable = pgTable(
  "merchandise_selections",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    status: text("status").notNull().default("draft"),

    /**
     * When this family was given the General Price List.
     *
     * Recorded rather than assumed, and it is the gate: no casket and no
     * outer burial container is returned to the family portal until it is
     * set. It is set when the family opens the price list, or when the
     * director records having handed one across the desk — both are the same
     * fact, which is that this family has the list.
     */
    gplShownAt: timestamp("gpl_shown_at"),
    /**
     * Which price list this selection was priced from. Snapshotted so a home
     * that raises its prices in March cannot change what a family agreed in
     * February.
     */
    gplEffectiveOn: timestamp("gpl_effective_on"),

    confirmedAt: timestamp("confirmed_at"),
    confirmedByUserId: integer("confirmed_by_user_id"),

    /**
     * A note about the home's own books, and nothing more.
     *
     * We do not process payments, so we do not know whether this was paid.
     * A director ticks this from their own accounts and the interface says
     * so in those words — it is never phrased as a receipt, a confirmation
     * or a cleared payment, because all three would be us claiming to know
     * something we cannot.
     */
    settledAt: timestamp("settled_at"),
    settledByUserId: integer("settled_by_user_id"),
    settledNote: text("settled_note"),

    /** What the director wants on the statement under the line items. */
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("merchandise_selections_case_unique").on(table.caseId),
    index("merchandise_selections_home_idx").on(
      table.funeralHomeId,
      table.status,
    ),
  ],
);

/**
 * What kind of line this is.
 *
 * `family_provided` is the one that matters legally. A funeral provider may
 * not refuse a casket or urn a family bought somewhere else, and may not
 * charge a handling fee for one — so that path carries no price, and the
 * check constraint below is there because "we will just leave the field
 * blank" is a promise that lasts until the first home asks for it.
 */
export const SELECTION_LINE_KINDS = [
  "item",
  "family_provided",
  "package_adjustment",
] as const;
export type SelectionLineKind = (typeof SELECTION_LINE_KINDS)[number];

export const merchandiseSelectionItemsTable = pgTable(
  "merchandise_selection_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    selectionId: integer("selection_id")
      .notNull()
      .references(() => merchandiseSelectionsTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("item"),

    /**
     * Where it came from, when it came from the catalogue at all.
     *
     * Nulled rather than cascaded if the catalogue row is ever hard-deleted:
     * a Statement the home handed to a family is a document, and a document
     * does not lose its lines because somebody tidied the price list.
     */
    catalogueItemId: integer("catalogue_item_id").references(
      () => catalogueItemsTable.id,
      { onDelete: "set null" },
    ),
    packageId: integer("package_id").references(() => cataloguePackagesTable.id, {
      onDelete: "set null",
    }),

    /* ------------------------------------------------------- the snapshot */

    /**
     * Name, description, section and price are copied here at the moment the
     * line is added, not joined at render time. The Statement of Funeral
     * Goods and Services Selected is the legal artifact of this component
     * and it has to say what was agreed — if it read through to the live
     * catalogue, a price change in March would silently rewrite what a
     * family signed in February.
     */
    name: text("name").notNull(),
    description: text("description"),
    section: text("section"),

    /**
     * Null on a `family_provided` line, and the constraint below is what
     * keeps it null. There is no fee, no surcharge and no handling charge
     * available on the path where a family brings their own casket or urn,
     * because charging one is a Funeral Rule violation and the surest way to
     * stop somebody filling a field in is not to give them one.
     */
    unitPriceCents: integer("unit_price_cents"),
    quantity: integer("quantity").notNull().default(1),

    /** "Her sister is bringing it on Thursday." Never a price. */
    notes: text("notes"),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("merchandise_selection_items_selection_idx").on(
      table.selectionId,
      table.position,
    ),
    index("merchandise_selection_items_home_idx").on(table.funeralHomeId),
    check(
      "merchandise_selection_items_no_fee_on_family_provided",
      sql`${table.kind} <> 'family_provided' or ${table.unitPriceCents} is null`,
    ),
    /**
     * A package adjustment is the only line that may be negative, because it
     * is the only one that is a discount. Everything else is a price.
     */
    check(
      "merchandise_selection_items_price_sign",
      sql`${table.kind} = 'package_adjustment' or ${table.unitPriceCents} is null or ${table.unitPriceCents} >= 0`,
    ),
    check(
      "merchandise_selection_items_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
  ],
);

export type StorefrontSettings = typeof storefrontSettingsTable.$inferSelect;
export type MerchandiseSelection = typeof merchandiseSelectionsTable.$inferSelect;
export type MerchandiseSelectionItem =
  typeof merchandiseSelectionItemsTable.$inferSelect;

/** What one line comes to. Null-priced lines contribute nothing. */
export function lineTotalCents(
  line: Pick<MerchandiseSelectionItem, "unitPriceCents" | "quantity">,
): number {
  if (line.unitPriceCents === null) return 0;
  return line.unitPriceCents * line.quantity;
}

/** What the family owes the home, before the home's own books say anything. */
export function selectionTotalCents(
  lines: readonly Pick<MerchandiseSelectionItem, "unitPriceCents" | "quantity">[],
): number {
  return lines.reduce((total, line) => total + lineTotalCents(line), 0);
}

/**
 * Whether this case may be shown anything about paying.
 *
 * A pre-need file records a plan and never takes a penny. Selling a preneed
 * contract in Colorado needs a Division of Insurance licence, a bond or
 * $100,000 of net worth and 85% of the money in trust (C.R.S. Title 10,
 * Article 15); there are exactly two lawful ways to fund one and neither is
 * a payment link. So the plan is priced, printed and recorded, and the money
 * is not discussed — here, in the API, or anywhere in either front end.
 */
export function mayDiscussPayment(row: { kind: string }): boolean {
  return row.kind !== "pre_need";
}

/** The disclosure text a home has written, by key, with blanks removed. */
export function disclosureText(
  settings: Pick<StorefrontSettings, "disclosures"> | null,
): Record<string, string> {
  const raw = settings?.disclosures;
  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, string> = {};
  for (const slot of GPL_DISCLOSURES) {
    const value = (raw as Record<string, unknown>)[slot.key];
    if (typeof value === "string" && value.trim() !== "") {
      out[slot.key] = value.trim();
    }
  }
  return out;
}

/** A home has a General Price List once it has dated one. */
export function hasGeneralPriceList(
  settings: Pick<StorefrontSettings, "gplEffectiveOn"> | null,
): boolean {
  return settings?.gplEffectiveOn != null;
}

export const disclosuresSchema = z.record(z.string(), z.string());
