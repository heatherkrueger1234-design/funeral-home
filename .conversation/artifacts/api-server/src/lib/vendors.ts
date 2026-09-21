import { and, asc, eq, isNull, or, sql, ilike } from "drizzle-orm";
import {
  db,
  postalCodesTable,
  vendorsTable,
  normalisePostalCode,
  type Vendor,
} from "@workspace/db";

/**
 * Finding local help, by actual miles.
 *
 * Distance is computed in SQL from the shipped ZIP centroids rather than by
 * loading every vendor and sorting in Node. That matters less for a home with
 * forty vendors than for the cemetery import, which puts tens of thousands of
 * rows in this table.
 */

export type Located = { latitude: number; longitude: number };

/** Look up a ZIP's centroid. Null when it is not a ZIP we know. */
export async function locate(postalCode: string): Promise<Located | null> {
  const code = normalisePostalCode(postalCode);
  if (!code) return null;

  const [row] = await db
    .select({
      latitude: postalCodesTable.latitude,
      longitude: postalCodesTable.longitude,
    })
    .from(postalCodesTable)
    .where(eq(postalCodesTable.code, code))
    .limit(1);

  return row ?? null;
}

/**
 * The haversine formula, as SQL.
 *
 * Written out rather than reached for through PostGIS: the extension is not
 * available on every managed Postgres a funeral home might end up on, and
 * this is six lines of trigonometry that needs no install and no migration.
 */
function distanceExpression(from: Located) {
  return sql<number>`
    3958.7613 * 2 * asin(sqrt(
      power(sin(radians(${vendorsTable.latitude} - ${from.latitude}) / 2), 2) +
      cos(radians(${from.latitude})) * cos(radians(${vendorsTable.latitude})) *
      power(sin(radians(${vendorsTable.longitude} - ${from.longitude}) / 2), 2)
    ))
  `;
}

export type VendorQuery = {
  funeralHomeId: number;
  kind?: string;
  near?: string;
  radiusMiles?: number;
  search?: string;
  /** Family-facing lists show only what the home has chosen to show. */
  visibleOnly?: boolean;
  limit?: number;
};

export type VendorWithDistance = Vendor & { distanceMiles: number | null };

export async function findVendors(
  query: VendorQuery,
): Promise<VendorWithDistance[]> {
  const from = query.near ? await locate(query.near) : null;

  const distance = from ? distanceExpression(from) : sql<number>`null`;

  const rows = await db
    .select({ vendor: vendorsTable, distanceMiles: distance })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.funeralHomeId, query.funeralHomeId),
        isNull(vendorsTable.archivedAt),
        query.kind ? eq(vendorsTable.kind, query.kind) : undefined,
        query.visibleOnly ? eq(vendorsTable.visibleToFamily, true) : undefined,
        query.search
          ? or(
              ilike(vendorsTable.name, `%${query.search}%`),
              ilike(vendorsTable.city, `%${query.search}%`),
              ilike(vendorsTable.specialisms, `%${query.search}%`),
            )
          : undefined,
        /*
         * A radius filters, but never hides a vendor we could not place.
         * A monument company whose ZIP was mistyped should still appear at
         * the bottom of the list rather than vanishing silently — the
         * director can see it needs fixing, which they cannot do if it is
         * gone.
         */
        from && query.radiusMiles
          ? or(
              isNull(vendorsTable.latitude),
              sql`${distance} <= ${query.radiusMiles}`,
            )
          : undefined,
      ),
    )
    .orderBy(
      // The home's own recommendation leads, then nearest, then by name.
      sql`${vendorsTable.preferred} desc`,
      from ? sql`${distance} asc nulls last` : asc(vendorsTable.name),
      asc(vendorsTable.name),
    )
    .limit(query.limit ?? 100);

  return rows.map(({ vendor, distanceMiles }) => ({
    ...vendor,
    distanceMiles:
      distanceMiles === null ? null : Math.round(Number(distanceMiles) * 10) / 10,
  }));
}

/** The shape the API returns. Internal columns stay internal. */
export function toVendorJson(row: VendorWithDistance) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    contactName: row.contactName,
    phone: row.phone,
    email: row.email,
    website: row.website,
    addressLine1: row.addressLine1,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    specialisms: row.specialisms,
    languages: row.languages,
    notes: row.notes,
    visibleToFamily: row.visibleToFamily,
    preferred: row.preferred,
    source: row.source,
    distanceMiles: row.distanceMiles,
  };
}

/**
 * Fill in a vendor's coordinates from its ZIP.
 *
 * Done on write so that listing never geocodes. Returns nulls for an
 * unrecognised ZIP rather than throwing: a director half-way through typing a
 * monument company's details should not be stopped by a postcode.
 */
export async function coordinatesFor(
  postalCode: string | null | undefined,
): Promise<{ latitude: number | null; longitude: number | null }> {
  if (!postalCode) return { latitude: null, longitude: null };

  const found = await locate(postalCode);

  return found
    ? { latitude: found.latitude, longitude: found.longitude }
    : { latitude: null, longitude: null };
}
