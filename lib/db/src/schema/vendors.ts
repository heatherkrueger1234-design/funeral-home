import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { familyContactsTable } from "./family-contacts";

/**
 * ZIP centroids, so "near me" means miles rather than a prefix match.
 *
 * Loaded from the Census Bureau's national ZCTA gazetteer, which is federal
 * work and therefore public domain. 33,791 rows, about 370 kB gzipped, and
 * it turns proximity into arithmetic that works anywhere in the country
 * without an API call, a key, or a per-lookup charge.
 *
 * Centroids rather than boundaries. A ZIP covering half a rural county is
 * represented by its middle, which is plenty to rank three monument companies
 * by distance and not enough to do anything more precise with.
 */
export const postalCodesTable = pgTable(
  "postal_codes",
  {
    code: text("code").primaryKey(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
  },
);

export type PostalCode = typeof postalCodesTable.$inferSelect;

/**
 * The home's local network: monument companies, cemeteries, casket and urn
 * dealers, clergy for hire, florists.
 *
 * The reason this belongs in the product rather than in a director's head:
 * "who do you recommend for a headstone?" is one of the most common questions
 * a family asks, it is asked weeks after the funeral when the case is closed
 * and the director has moved on, and the answer currently lives in one
 * person's memory. A home whose referrals outlive its staff is worth more
 * than one whose don't.
 *
 * **This is a referral directory, not a price list.** No prices are published
 * here. That is partly the FTC Funeral Rule, which governs how a funeral
 * provider must disclose *its own* goods and services and is not somewhere to
 * improvise; and partly that these are other people's prices to quote. What
 * is recorded is what a vendor said when asked — see `vendorQuotesTable`.
 *
 * Nothing is seeded. There is no public-domain nationwide directory of
 * monument makers or celebrants, and inventing plausible ones for a product
 * that hands them to bereaved families would be indefensible. Homes add their
 * own, import from a provider they license, or look one up live.
 */
export const vendorsTable = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),

    addressLine1: text("address_line1"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),

    /**
     * Resolved from `postalCode` on write, so proximity never depends on a
     * geocoding call at read time. Null when the ZIP was unrecognised, which
     * makes "we could not place this one" visible instead of silently
     * sorting it to the end of every list.
     */
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    /**
     * Roughly how far they will travel. Used to keep a monument company two
     * states away out of a list, without pretending to know their exact
     * service area.
     */
    serviceRadiusMiles: integer("service_radius_miles"),

    /** Denomination for clergy, materials for monument makers, languages. */
    specialisms: text("specialisms"),
    languages: text("languages"),

    /** Why this home recommends them. The part a director actually knows. */
    notes: text("notes"),

    /**
     * Whether the family sees them at all. Off by default: a vendor a
     * director is still forming an opinion about should not be a
     * recommendation to a grieving family the same afternoon.
     */
    visibleToFamily: boolean("visible_to_family").notNull().default(false),
    /** The home's first suggestion in this category. */
    preferred: boolean("preferred").notNull().default(false),

    /**
     * Where the row came from: `home` (typed in), `places` (looked up live),
     * `gnis` (the federal cemetery import). Worth keeping, because a name and
     * a location from a federal gazetteer is a different kind of fact from a
     * director's own recommendation, and the family is told which.
     */
    source: text("source").notNull().default("home"),
    /** The provider's own id, so a re-import updates rather than duplicates. */
    sourceRef: text("source_ref"),

    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("vendors_home_kind_idx").on(table.funeralHomeId, table.kind),
    index("vendors_location_idx").on(table.latitude, table.longitude),
    uniqueIndex("vendors_source_ref_unique").on(
      table.funeralHomeId,
      table.source,
      table.sourceRef,
    ),
  ],
);

export const VENDOR_KINDS = [
  "monument",
  "cemetery",
  "casket",
  "urn",
  "clergy",
  "celebrant",
  "florist",
  "musician",
  "caterer",
  "transport",
  "other",
] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

export const VENDOR_SOURCES = ["home", "places", "gnis"] as const;
export type VendorSource = (typeof VENDOR_SOURCES)[number];

/**
 * A family asking a vendor for a price, passed through the home.
 *
 * Deliberately a request rather than a transaction. The home does not take
 * payment, set the price, or promise the quote is honoured — it introduces
 * two parties and keeps a record so the family can compare three headstone
 * quotes without having to remember three phone calls made in the worst week
 * of their life.
 *
 * `quotedAmountCents` is what the vendor said, recorded by staff. It is not
 * the home's price and is never presented as one.
 */
export const vendorQuotesTable = pgTable(
  "vendor_quotes",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),

    /** Which family member asked, when it came from the portal. */
    requestedByContactId: integer("requested_by_contact_id").references(
      () => familyContactsTable.id,
      { onDelete: "set null" },
    ),

    /** "A double headstone, granite, room for my father later." */
    request: text("request"),

    status: text("status").notNull().default("requested"),

    /** What came back. Recorded by staff, in the vendor's own terms. */
    quotedAmountCents: integer("quoted_amount_cents"),
    response: text("response"),

    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("vendor_quotes_case_idx").on(table.caseId),
    index("vendor_quotes_home_idx").on(table.funeralHomeId, table.status),
  ],
);

export const QUOTE_STATUSES = [
  "requested",
  "passed_on",
  "quoted",
  "declined",
  "chosen",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({
  id: true,
  funeralHomeId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
export type VendorQuote = typeof vendorQuotesTable.$inferSelect;

/** Miles between two points. Haversine — good to a few feet at these ranges. */
export function milesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_MILES = 3958.7613;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** ZIPs are five digits and lose their leading zero to every spreadsheet. */
export function normalisePostalCode(raw: string): string | null {
  const digits = raw.trim().replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 5) return null;
  return digits.padStart(5, "0");
}
