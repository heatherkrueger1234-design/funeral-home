import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What a home sells, at the home's own prices.
 *
 * This ships empty and stays empty until a director loads it. There is no
 * starter catalogue, no suggested price, no typical markup and no default
 * urn anywhere in this file or any migration of it, and that is not modesty:
 * a home's merchandise and what it charges for it are its margin, its
 * livelihood and its own Funeral Rule disclosure. A vendor who puts a price
 * in front of a director is competing with the selection room, and a vendor
 * who competes with the selection room is uninstalled inside a quarter.
 *
 * The other half of the shape comes from the FTC Funeral Rule (16 CFR 453),
 * which binds the home rather than us. It requires a General Price List, a
 * Casket Price List and an Outer Burial Container Price List, every item
 * priced individually, and it forbids selling only in packages. So the unit
 * here is the *item*, every item carries its own price, and `section` is
 * what decides which of the three statutory lists it prints on. Packages sit
 * on top of items and never replace them — see `catalogue_packages`.
 */

/**
 * Which statutory price list a category's items belong to.
 *
 * Fixed rather than named by the home, because these are the Rule's own
 * divisions and a home that invents a fourth one has a price list that does
 * not comply. What the home *does* name is the category — "Cremation urns",
 * "Traditional caskets", "Our services" — and that name is what a family
 * reads. This column is only ever read by the price-list renderer.
 */
export const CATALOGUE_SECTIONS = [
  /** Professional services, staff, facilities, transport. GPL only. */
  "services",
  /** Caskets and alternative containers. GPL and the Casket Price List. */
  "caskets",
  /** Vaults and grave liners. GPL and the Outer Burial Container Price List. */
  "outer_burial_containers",
  /** Urns, keepsakes, register books, memorial printing. GPL only. */
  "merchandise",
  /**
   * Things the home pays for on the family's behalf and passes on — a
   * cemetery's opening fee, a newspaper notice, a certified copy. Disclosed
   * separately on the GPL because the Rule treats them separately, and
   * because a family reading a bill deserves to know which numbers are the
   * home's and which are somebody else's.
   */
  "cash_advance",
] as const;
export type CatalogueSection = (typeof CATALOGUE_SECTIONS)[number];

/** The sections a family may not be shown until the GPL is in their hands. */
export const SECTIONS_BEHIND_THE_GPL: readonly CatalogueSection[] = [
  "caskets",
  "outer_burial_containers",
];

export const catalogueCategoriesTable = pgTable(
  "catalogue_categories",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** The home's own words. Printed as the heading a family reads. */
    name: text("name").notNull(),
    /** One sentence under the heading. Optional, and usually worth having. */
    description: text("description"),

    /** One of `CATALOGUE_SECTIONS`. Decides which price lists it prints on. */
    section: text("section").notNull(),

    position: integer("position").notNull().default(0),
    /**
     * Retired rather than deleted. A category deleted outright would orphan
     * the items a confirmed statement was built from, and a statement is a
     * document the home handed to a family — it does not get to change.
     */
    archivedAt: timestamp("archived_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("catalogue_categories_home_idx").on(
      table.funeralHomeId,
      table.section,
      table.position,
    ),
  ],
);

/**
 * How a home says an item can be had.
 *
 * `by_request` is the honest answer for the casket a home will order in but
 * does not keep, and it is deliberately not "out of stock": a family reading
 * "out of stock" about their mother's casket hears a shop.
 */
export const ITEM_AVAILABILITY = ["available", "by_request"] as const;
export type ItemAvailability = (typeof ITEM_AVAILABILITY)[number];

export const catalogueItemsTable = pgTable(
  "catalogue_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => catalogueCategoriesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /**
     * What it is made of, what it is lined with, what is included.
     *
     * The Rule wants a casket identified well enough that a family can
     * compare it with one somewhere else, which in practice means the gauge
     * of the steel or the species of the wood. It is one field rather than
     * six because a director typing six fields for two hundred caskets types
     * none of them.
     */
    description: text("description"),

    /**
     * The home's own reference, if it has one — the code on the supplier's
     * invoice. Carried so a spreadsheet re-import updates the row it came
     * from instead of adding a second copy of every casket.
     */
    itemCode: text("item_code"),

    /**
     * The price, in whole cents.
     *
     * Integer cents rather than `numeric` or a float, because every number
     * in this system is added to other numbers and shown to a family on a
     * document the Rule requires to be accurate. Floating point gets that
     * wrong by a cent often enough to matter, and a cent wrong on a
     * statement is a phone call the director should not have to take.
     *
     * We never set this, never suggest it, never mark it up and never take a
     * share of it. The only thing this system knows about a price is which
     * number to print.
     */
    priceCents: integer("price_cents").notNull(),
    /** "each", "per day", "per mile". Printed beside the price, never parsed. */
    priceUnit: text("price_unit"),

    photoUploadId: integer("photo_upload_id"),

    availability: text("availability").notNull().default("available"),

    position: integer("position").notNull().default(0),
    /** Withdrawn from sale. Kept, for the same reason categories are kept. */
    archivedAt: timestamp("archived_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("catalogue_items_home_idx").on(table.funeralHomeId, table.categoryId),
    index("catalogue_items_category_idx").on(table.categoryId, table.position),
    /**
     * An item code, where the home uses one, identifies one item per home.
     * This is what lets the same spreadsheet be dropped in twice — the
     * second time updates prices rather than doubling the catalogue.
     */
    uniqueIndex("catalogue_items_code_unique")
      .on(table.funeralHomeId, table.itemCode)
      .where(sql`${table.itemCode} is not null`),
    /**
     * A negative price is a discount dressed as an item, and a discount
     * belongs on the package adjustment line where a family can see what it
     * applies to. Rejected at the column so no import path can sneak one in.
     */
    check("catalogue_items_price_not_negative", sql`${table.priceCents} >= 0`),
  ],
);

/**
 * A package: several items, offered together, at a price of the home's own.
 *
 * The Funeral Rule permits packages and forbids selling *only* in packages,
 * so this table exists strictly on top of the itemised catalogue and never
 * instead of it. Choosing a package does not create a package line: it fills
 * the family's selection with the package's items, each at its own itemised
 * price, plus one adjustment line carrying the difference. Declining any one
 * of those items then works exactly as declining any other item does — the
 * item goes, the adjustment goes with it, and the total changes in front of
 * the family. That is the behaviour the Rule is actually about.
 */
export const cataloguePackagesTable = pgTable(
  "catalogue_packages",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),

    /**
     * What the home charges for the set. Compared against the sum of the
     * members at render time so the saving is always arithmetic anyone can
     * check, rather than a second number to keep in step.
     */
    priceCents: integer("price_cents").notNull(),

    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("catalogue_packages_home_idx").on(table.funeralHomeId, table.position),
    check(
      "catalogue_packages_price_not_negative",
      sql`${table.priceCents} >= 0`,
    ),
  ],
);

export const cataloguePackageItemsTable = pgTable(
  "catalogue_package_items",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    packageId: integer("package_id")
      .notNull()
      .references(() => cataloguePackagesTable.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => catalogueItemsTable.id, { onDelete: "cascade" }),

    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [
    uniqueIndex("catalogue_package_items_unique").on(
      table.packageId,
      table.itemId,
    ),
    index("catalogue_package_items_home_idx").on(table.funeralHomeId),
    check(
      "catalogue_package_items_quantity_positive",
      sql`${table.quantity} > 0`,
    ),
  ],
);

export const insertCatalogueCategorySchema = createInsertSchema(
  catalogueCategoriesTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertCatalogueCategory = z.infer<
  typeof insertCatalogueCategorySchema
>;
export type CatalogueCategory = typeof catalogueCategoriesTable.$inferSelect;

export const insertCatalogueItemSchema = createInsertSchema(
  catalogueItemsTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertCatalogueItem = z.infer<typeof insertCatalogueItemSchema>;
export type CatalogueItem = typeof catalogueItemsTable.$inferSelect;

export type CataloguePackage = typeof cataloguePackagesTable.$inferSelect;
export type CataloguePackageItem = typeof cataloguePackageItemsTable.$inferSelect;

/** Whether this section is one the family may not see before the GPL. */
export function isBehindTheGpl(section: string): boolean {
  return (SECTIONS_BEHIND_THE_GPL as readonly string[]).includes(section);
}

/**
 * Money, as an American family reads it.
 *
 * Kept here beside the column it formats so that the price list, the
 * statement and both front ends cannot drift into three different opinions
 * about whether to print the cents.
 */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
