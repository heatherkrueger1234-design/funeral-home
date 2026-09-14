import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * The home's own prices, for the home's own staff. Nothing else.
 *
 * Read this before adding a route that touches this table.
 *
 * A director arranging at a kitchen table gets asked what a graveside service
 * costs, and currently answers by ringing the office or remembering. That is
 * the whole problem being solved here: a crib sheet, on the screen they
 * already have open. It is not a quote, it is not an invoice, and it is not
 * a price list in the sense the law means.
 *
 * That distinction is load-bearing. The FTC Funeral Rule governs how a
 * funeral provider discloses prices to the public and to anyone who asks --
 * a General Price List with mandated categories, mandated wording, handed
 * over in person before any discussion of arrangements. A national SaaS that
 * quietly published a home's numbers to families would be generating that
 * home a compliance problem in fifty states at once, and would be doing it
 * from a text box a receptionist typed into.
 *
 * So these rows are staff-only, and staff-only is enforced by where they can
 * be reached from rather than by intention:
 *
 *   - every route touching this table is mounted below `requireAuth`;
 *   - no family route reads it, and no public route reads it;
 *   - `toPublicFuneralHome` does not know it exists;
 *   - and `price-list.test.ts` asserts all of that, so a future handler that
 *     helpfully includes prices in the family's session fails CI rather than
 *     shipping.
 *
 * If a home ever wants prices in front of families, the answer is not to
 * relax any of that. It is a separate, deliberate, Funeral-Rule-shaped
 * feature with the mandated categories and disclosures, built on purpose.
 */
export const homePriceItemsTable = pgTable(
  "home_price_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * The home's own heading -- "Services", "Caskets", "Cash advances".
     * Free text rather than an enum: this is a crib sheet in the home's own
     * words, and an enum here would be this product quietly asserting a
     * taxonomy of funerals that the law already has opinions about.
     */
    category: text("category").notNull(),
    label: text("label").notNull(),

    /**
     * Cents, because money in a float is how a $2,495.00 casket becomes
     * $2,494.99 on the third render. Nullable on purpose: some lines
     * genuinely have no number -- flowers at market, a cemetery's own fee --
     * and a home forced to type 0 there would be writing down something
     * false. Null means "see the note".
     */
    amountCents: integer("amount_cents"),

    /** "Per day", "plus cemetery charges", "from". The asterisk, written out. */
    note: text("note"),

    position: integer("position").notNull().default(0),

    /**
     * Off keeps the row and takes it off the sheet. Homes stop offering
     * things, and a deleted row takes with it the last record of what the
     * home was charging in the year somebody is now asking about.
     */
    enabled: boolean("enabled").notNull().default(true),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_price_items_home_idx").on(
      table.funeralHomeId,
      table.category,
      table.position,
    ),
  ],
);

export const insertHomePriceItemSchema = createInsertSchema(
  homePriceItemsTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertHomePriceItem = z.infer<typeof insertHomePriceItemSchema>;
export type HomePriceItem = typeof homePriceItemsTable.$inferSelect;

/**
 * Cents to "$2,495.00", or to null.
 *
 * US dollars without a currency column, deliberately: the rest of this
 * product is already US-only -- ZIP codes, the Funeral Rule, `+1` as the
 * default dialling code -- and a currency field would be the one piece of
 * internationalisation in a system that has none, which is worse than the
 * honest limitation.
 */
export function formatAmount(amountCents: number | null): string | null {
  if (amountCents === null) return null;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}
