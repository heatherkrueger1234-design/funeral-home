import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { uploadsTable } from "./uploads";

/**
 * The home's merchandise and the home's ground.
 *
 * Worth being exact about whose money this is, because the wrong answer kills
 * the sale: **these are the funeral home's items, at the home's prices, and
 * the home takes the payment.** Nothing in this product touches the
 * transaction. A family browsing an urn on the sofa instead of in a
 * windowless selection room is a service to the home's margin, not a
 * competitor to it.
 *
 * Prices are integer cents. Never a float: a `numeric` read back through a
 * driver as a string and then multiplied is where a $1,150 casket quietly
 * becomes $1,149.99 on a printed statement.
 */

export const INVENTORY_KINDS = [
  "urn",
  "casket",
  "keepsake",
  "stationery",
  "vault",
  "marker",
  "other",
] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export const inventoryItemsTable = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    kind: text("kind").notNull().default("urn"),
    description: text("description"),

    /** Cents. See the note above. */
    priceCents: integer("price_cents").notNull().default(0),

    /** The home's own photograph of the actual item on their actual shelf. */
    photoUploadId: integer("photo_upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),

    /**
     * Shown to families, or not.
     *
     * A home takes something off the shelf far more often than it deletes it
     * — the supplier is out of stock, or the line is discontinued but three
     * families have already chosen it. Deleting would break their selections.
     */
    available: boolean("available").notNull().default(true),

    /** The home's own stock code, so their invoice and this agree. */
    sku: text("sku"),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("inventory_items_home_idx").on(table.funeralHomeId, table.position),
  ],
);

/**
 * A plot, a niche, or a scattering bed the home has to sell.
 *
 * Only homes that own ground have these. A home with an empty table simply
 * does not get the screen, which is the same rule the vendor directory
 * follows: an empty list is a decision, not a gap.
 */
export const PLOT_KINDS = ["burial", "niche", "scattering", "mausoleum"] as const;
export type PlotKind = (typeof PLOT_KINDS)[number];

export const cemeteryPlotsTable = pgTable(
  "cemetery_plots",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** "Cedar Rise, section C". As the sexton's map calls it. */
    section: text("section").notNull(),
    /** "C-114". Unique within the home, because it is on a map and a deed. */
    plotNumber: text("plot_number").notNull(),

    kind: text("kind").notNull().default("burial"),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),

    /**
     * Taken, and by which case.
     *
     * Nullable and not a unique index on `caseId`, because a couple takes two
     * adjoining plots against two separate pre-need files and the pair is the
     * normal purchase, not the exception.
     */
    reservedByCaseId: integer("reserved_by_case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    reservedAt: timestamp("reserved_at"),

    /** Occupied. Distinct from reserved: one is sold, the other is used. */
    interredAt: timestamp("interred_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cemetery_plots_number_idx").on(table.funeralHomeId, table.plotNumber),
    index("cemetery_plots_home_idx").on(table.funeralHomeId, table.section),
  ],
);

/**
 * What a family — or the person themselves, years earlier — marked.
 *
 * Explicitly *not* an order. There is no total, no tax, no invoice and no
 * payment here, and that is a product decision with the FTC Funeral Rule
 * behind it: how a price is disclosed is governed, every state's pre-need
 * statute differs, and a national SaaS generating that paperwork would be
 * selling homes a compliance problem. This records an intention so the
 * arrangement conference starts from something rather than from nothing.
 */
export const caseMerchandiseTable = pgTable(
  "case_merchandise",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => inventoryItemsTable.id, { onDelete: "cascade" }),

    quantity: integer("quantity").notNull().default(1),

    /** `family`, `self` (chosen pre-need), or `staff`. */
    chosenBy: text("chosen_by").notNull().default("family"),

    /**
     * The price when it was chosen.
     *
     * Copied rather than joined, because a pre-need choice made in 2022 was
     * made against 2022's price and a home that honours it needs to be able
     * to show what that was. Joining would silently re-price the dead.
     */
    priceCentsAtChoice: integer("price_cents_at_choice").notNull().default(0),

    note: text("note"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_merchandise_unique_idx").on(table.caseId, table.itemId),
    index("case_merchandise_case_idx").on(table.caseId),
  ],
);

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable)
  .omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true })
  .extend({ kind: z.enum(INVENTORY_KINDS), priceCents: z.number().int().min(0) });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;

export const insertCemeteryPlotSchema = createInsertSchema(cemeteryPlotsTable)
  .omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true })
  .extend({ kind: z.enum(PLOT_KINDS), priceCents: z.number().int().min(0) });
export type InsertCemeteryPlot = z.infer<typeof insertCemeteryPlotSchema>;
export type CemeteryPlot = typeof cemeteryPlotsTable.$inferSelect;
export type CaseMerchandise = typeof caseMerchandiseTable.$inferSelect;

/** Cents to "$1,150.00", once, here, rather than in four frontend files. */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
