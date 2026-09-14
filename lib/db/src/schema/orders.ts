import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { usersTable } from "./users";

/**
 * What the family chose, what it costs, and where to go to settle it.
 *
 * Read this paragraph before adding a column. **No money moves through this
 * product.** There is no processing here, no funds held, no card or bank
 * detail stored, and no percentage taken of anything a home sells. A family
 * that owes a funeral home money is sent to the home's own payment page, at
 * the home's own processor, under the home's own merchant account. The only
 * money in this system is the home's monthly subscription to us, and that
 * lives in `lib/billing.ts` and is never extended to a family.
 *
 * That is not squeamishness. Homes have taken money for a century and have a
 * processor and a bookkeeper already; we would be a second thing to
 * reconcile. Routing funds on their behalf would raise money-transmission
 * questions in every state we sell into, card data would put us in PCI scope,
 * and connected-account onboarding — identity checks, bank details,
 * underwriting — is a wall standing between a home and its first useful day.
 *
 * So what these tables hold is a document and a signpost, and if a field ever
 * looks like it wants a card number in it, the field is wrong.
 */

/* --------------------------------------------------------- the statement -- */

/**
 * A Statement of Funeral Goods and Services Selected.
 *
 * The itemised document the FTC Funeral Rule requires a funeral provider to
 * give at the end of an arrangement conference: everything selected, the
 * price of each, the total, and — where an item is only being bought because
 * some law or a cemetery insists on it — the sentence saying so.
 *
 * The home is the funeral provider. We are not, and nothing rendered from
 * this table may suggest otherwise; the document carries the home's name and
 * address because it is the home's document.
 *
 * A case may have several of these. One is being worked on at a time
 * (`draft`); confirming it freezes it, and a change after that is a new
 * statement that supersedes the old one rather than an edit. The reason is
 * that a confirmed statement is the copy that was handed to a family, and a
 * document that can be quietly rewritten afterwards is no evidence of
 * anything.
 */
export const statementsTable = pgTable(
  "case_statements",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /**
     * `draft` — the director and the family are still deciding. Editable,
     * never shown to the family as a total, because the Colorado Consumer
     * Protection Act view of price presentation is that the first number
     * somebody is shown is the number they pay.
     * `confirmed` — handed over. Frozen.
     * `superseded` — replaced by a later statement, kept because it was once
     * the live one.
     */
    status: text("status").notNull().default("draft"),

    /** Revisions of the same arrangement, counting from one. */
    version: integer("version").notNull().default(1),
    /**
     * The confirmed statement this one replaces. A soft pointer rather than a
     * foreign key to the same table, so that erasing a case's history in one
     * statement cannot cascade into the others.
     */
    supersedesStatementId: integer("supersedes_statement_id"),

    /**
     * The home's own number for this, so it reconciles against their books.
     * Ours is the `id`, and a bookkeeper has never once wanted ours.
     */
    reference: text("reference"),

    /** Printed at the foot, in the home's own words. */
    notes: text("notes"),

    confirmedAt: timestamp("confirmed_at"),
    confirmedByUserId: integer("confirmed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /**
     * A note about the home's records. **Not a receipt.**
     *
     * We do not process the payment, are not told about it, and have no way
     * of knowing whether one was made. What this column means is that a
     * member of staff looked at the home's own books and marked it. Every
     * sentence rendered from it has to say that much and no more — "marked
     * settled in their records", never "paid", never "payment received", and
     * never anything a family could read as confirmation from us.
     */
    settledAt: timestamp("settled_at"),
    settledByUserId: integer("settled_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    /** How the home recorded it, in their words: "check, 14 March". */
    settledNote: text("settled_note"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_statements_case_id_idx").on(table.caseId, table.status),
    index("case_statements_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const STATEMENT_STATUSES = ["draft", "confirmed", "superseded"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

/* ------------------------------------------------------------- the lines -- */

/**
 * One line of the statement.
 *
 * The four kinds are the sections a funeral statement has actually had for
 * decades, and they are kinds rather than free text because two of them carry
 * obligations:
 *
 * - `cash_advance` is something the home buys on the family's behalf —
 *   certified copies, an organist, a cemetery's opening fee. The Funeral Rule
 *   requires a provider that marks these up, or charges for obtaining them,
 *   to say so on the statement. That sentence goes in `disclosure`.
 * - `family_provided` is the casket or urn the family bought somewhere else.
 *   A provider may not refuse to handle one and may not charge a fee for it,
 *   so this kind carries no price and the API refuses to give it one. There
 *   is deliberately no field here for a handling fee, because a field like
 *   that is one somebody eventually fills in.
 *
 * `allowance` is the fourth: a discount, a staff courtesy, a veteran's
 * allowance the home is absorbing. Stored as a positive amount and
 * subtracted, because a negative number in a price column is read wrong by
 * somebody eventually.
 */
export const statementLinesTable = pgTable(
  "statement_lines",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    statementId: integer("statement_id")
      .notNull()
      .references(() => statementsTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull(),

    /**
     * The home's own words for the item, copied in at the moment it was
     * chosen rather than read through a join at print time.
     *
     * This looks like denormalisation and is the opposite of a mistake. The
     * statement is a record of what was agreed on a particular afternoon at
     * the prices that were on the price list that afternoon. A home that
     * renames a casket or puts its prices up in April must not thereby change
     * what a family was handed in March.
     */
    description: text("description").notNull(),
    /** "20 gauge steel, ivory crepe" — the second line, when there is one. */
    detail: text("detail"),

    /**
     * Which catalogue item this came from, where it came from one at all.
     * Deliberately not a foreign key: the catalogue is another component's
     * table, a line may be typed in by hand with no catalogue behind it, and
     * an item withdrawn from sale must not be able to delete a line out of a
     * document that has already been handed to somebody.
     */
    catalogueItemId: integer("catalogue_item_id"),

    quantity: integer("quantity").notNull().default(1),

    /**
     * Price for one, in whole cents. Integers because a funeral statement is
     * added up and read aloud, and binary floating point cannot be trusted
     * with either. No currency column: these are American funeral homes and
     * a second currency would need far more thought than a column.
     */
    unitAmountCents: integer("unit_amount_cents").notNull().default(0),

    /**
     * The sentence the Funeral Rule requires beside this line, when one is
     * required: the specific law or cemetery or crematory requirement that
     * makes the purchase necessary, or the home's disclosure that it charges
     * for obtaining a cash advance item.
     *
     * Written by the home. We supply no wording — a national vendor drafting
     * a provider's legal disclosures is handing every home that used it
     * somebody else's liability.
     */
    disclosure: text("disclosure"),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("statement_lines_statement_id_idx").on(
      table.statementId,
      table.position,
    ),
    index("statement_lines_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const STATEMENT_LINE_KINDS = [
  "service",
  "merchandise",
  "cash_advance",
  "family_provided",
  "allowance",
] as const;
export type StatementLineKind = (typeof STATEMENT_LINE_KINDS)[number];

/** The order the sections appear in on the printed document. */
export const STATEMENT_SECTIONS: ReadonlyArray<{
  kind: StatementLineKind;
  heading: string;
  /** Said once under the heading, where the section needs explaining. */
  note: string | null;
}> = [
  {
    kind: "service",
    heading: "Services",
    note: null,
  },
  {
    kind: "merchandise",
    heading: "Merchandise",
    note: null,
  },
  {
    kind: "cash_advance",
    heading: "Cash advance items",
    note: "Paid by the funeral home on your behalf to somebody else.",
  },
  {
    kind: "family_provided",
    heading: "Provided by the family",
    note: "Brought in by you. There is no charge for handling it.",
  },
  {
    kind: "allowance",
    heading: "Allowances",
    note: null,
  },
];

/**
 * A casket or urn the family brought in carries no price and no fee, ever.
 *
 * The Funeral Rule is explicit that a provider may not refuse to handle a
 * third-party casket or urn and may not charge a handling fee or surcharge
 * for one. Rather than trusting every caller to remember that, the rule lives
 * here, next to the column, and the API runs it on the way in.
 */
export function isUnpricedKind(kind: string): boolean {
  return kind === "family_provided";
}

/** What a line adds to, or takes off, the total. */
export function lineSubtotalCents(
  line: Pick<StatementLine, "kind" | "quantity" | "unitAmountCents">,
): number {
  if (isUnpricedKind(line.kind)) return 0;

  const gross = line.quantity * line.unitAmountCents;
  return line.kind === "allowance" ? -gross : gross;
}

/**
 * The total, added up from the lines rather than stored beside them.
 *
 * A stored total is a second source of truth for the one number on the page
 * that has to be right, and the two disagree the first time a line is edited
 * and something fails halfway. The lines of a confirmed statement cannot
 * change, so adding them up gives the same answer for ever.
 */
export function statementTotalCents(
  lines: ReadonlyArray<Pick<StatementLine, "kind" | "quantity" | "unitAmountCents">>,
): number {
  return lines.reduce((sum, line) => sum + lineSubtotalCents(line), 0);
}

/** Cents to the string a family reads. Two decimal places, always. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/* ---------------------------------------------------------- the handoff -- */

/**
 * Where the home takes payment, and how else it will take it.
 *
 * One row per home. The entire payment feature of this product is this table
 * plus a hyperlink: the family is shown their total and sent to the page the
 * home already has, and what happens after that click is between the family,
 * the home and the home's processor.
 *
 * Kept out of `funeral_homes` because that table belongs to another
 * component and because this is a setting a director edits on its own screen,
 * not part of the tenant record.
 */
export const paymentHandoffTable = pgTable(
  "payment_handoff",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * The home's own payment page. HTTPS only, and the hostname is shown to
     * the family beside the link.
     *
     * A message about money, sent to somebody whose mother died on Tuesday,
     * is precisely what a funeral scam imitates. So this link is made as dull
     * as it can be made: the home's name, the home's hostname visible, no
     * shortener, no redirect through us, and nothing that reads as urgent.
     * Null is a perfectly normal state and the portal handles it by giving
     * the family the telephone number instead.
     */
    paymentPageUrl: text("payment_page_url"),

    /**
     * The other ways this home takes money, in the home's own words —
     * "we take a check at the office, or ring Dorothy on the main number".
     *
     * Plenty of families will never click a link, and a home that only ever
     * offered a web page would be worse to deal with than the home down the
     * road that answers the telephone.
     */
    otherWaysToPay: text("other_ways_to_pay"),

    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    updatedByUserId: integer("updated_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
  },
  (table) => [
    uniqueIndex("payment_handoff_funeral_home_id_unique").on(
      table.funeralHomeId,
    ),
  ],
);

/**
 * What is wrong with a payment link, or null when nothing is.
 *
 * Deliberately strict about the scheme. `http` is refused rather than
 * upgraded, because a home that has typed an `http` address has told us
 * something true about their payment page that they should hear from their
 * own web person, not have papered over by us. Credentials in the URL are
 * refused because they are only ever in one because somebody is being
 * phished.
 */
export function paymentPageUrlProblem(raw: string): string | null {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return "That doesn't look like a web address. It should start with https://";
  }

  if (url.protocol !== "https:") {
    return "A payment page has to start with https:// so families' details are protected on the way.";
  }

  if (url.username !== "" || url.password !== "") {
    return "Please use the plain address of the page, without a username or password in it.";
  }

  if (!url.hostname.includes(".")) {
    return "That address has no website name in it. Please paste the whole link from your browser.";
  }

  return null;
}

/** The bit of the link a family should recognise, for showing beside it. */
export function paymentPageHost(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- zod + types */

export const insertStatementSchema = createInsertSchema(statementsTable).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStatement = z.infer<typeof insertStatementSchema>;
export type Statement = typeof statementsTable.$inferSelect;

export const insertStatementLineSchema = createInsertSchema(
  statementLinesTable,
).omit({
  id: true,
  funeralHomeId: true,
  statementId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStatementLine = z.infer<typeof insertStatementLineSchema>;
export type StatementLine = typeof statementLinesTable.$inferSelect;

export type PaymentHandoff = typeof paymentHandoffTable.$inferSelect;
