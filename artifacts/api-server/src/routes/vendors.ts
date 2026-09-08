import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  vendorsTable,
  vendorQuotesTable,
  familyContactsTable,
  normalisePostalCode,
  type Vendor,
} from "@workspace/db";
import {
  CreateVendorBody,
  UpdateVendorBody,
  UpdateQuoteBody,
  GetVendorsQueryParams,
  LookupPlacesQueryParams,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../lib/http";
import { tenant } from "../middleware/require-auth";
import {
  coordinatesFor,
  findVendors,
  locate,
  toVendorJson,
} from "../lib/vendors";
import { lookupPlaces } from "../lib/places";
import { loadCase } from "./cases";

const router: IRouter = Router();

async function loadVendor(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<Vendor> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(vendorsTable)
    .where(
      and(eq(vendorsTable.id, id), eq(vendorsTable.funeralHomeId, home.id)),
    )
    .limit(1);

  return requireRow(row, "That vendor could not be found.");
}

router.get("/vendors", async (req, res) => {
  const home = tenant(req);
  const query = parseQuery(GetVendorsQueryParams, req.query);

  const rows = await findVendors({
    funeralHomeId: home.id,
    kind: query.kind,
    near: query.near,
    radiusMiles: query.radiusMiles,
    search: query.search?.trim() || undefined,
  });

  res.json(rows.map(toVendorJson));
});

/**
 * Search a live provider for real businesses near a ZIP.
 *
 * Everything found here is a candidate, not a listing: a director reads it,
 * recognises the name or does not, and saves the ones they would actually
 * put in front of a family.
 */
router.get("/vendors/lookup", async (req, res) => {
  const home = tenant(req);
  const query = parseQuery(LookupPlacesQueryParams, req.query);

  const from = await locate(query.near);

  if (!from) {
    throw badRequest(`"${query.near}" is not a US ZIP code we recognise.`);
  }

  const found = await lookupPlaces({
    kind: query.kind,
    from,
    radiusMiles: query.radiusMiles ?? 25,
  });

  // Mark the ones already in this home's directory, so a director scanning
  // twenty results can see at a glance what is new.
  const existing = await db
    .select({ sourceRef: vendorsTable.sourceRef })
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.funeralHomeId, home.id),
        eq(vendorsTable.source, "places"),
      ),
    );

  const saved = new Set(existing.map((row) => row.sourceRef));

  res.json({
    ...found,
    results: found.results.map((candidate) => ({
      ...candidate,
      alreadySaved: saved.has(candidate.sourceRef),
    })),
  });
});

router.post("/vendors", async (req, res) => {
  const home = tenant(req);
  const values = parseBody(CreateVendorBody, req.body);

  const name = values.name.trim();
  if (!name) throw badRequest("Please give the vendor a name.");

  const postalCode = values.postalCode
    ? normalisePostalCode(values.postalCode)
    : null;
  const coords = await coordinatesFor(postalCode);

  const [created] = await db
    .insert(vendorsTable)
    .values({
      funeralHomeId: home.id,
      kind: values.kind,
      name,
      contactName: values.contactName ?? null,
      phone: values.phone ?? null,
      email: values.email ?? null,
      website: values.website ?? null,
      addressLine1: values.addressLine1 ?? null,
      city: values.city ?? null,
      region: values.region ?? null,
      postalCode,
      specialisms: values.specialisms ?? null,
      languages: values.languages ?? null,
      notes: values.notes ?? null,
      visibleToFamily: values.visibleToFamily ?? false,
      preferred: values.preferred ?? false,
      source: values.source ?? "home",
      sourceRef: values.sourceRef ?? null,
      ...coords,
    })
    // Saving the same lookup result twice is a double-click, not an intent.
    .onConflictDoNothing()
    .returning();

  if (!created) {
    throw badRequest("That one is already in your directory.");
  }

  res.status(201).json(toVendorJson({ ...created, distanceMiles: null }));
});

router.put("/vendors/:vendorId", async (req, res) => {
  const existing = await loadVendor(req, req.params.vendorId);
  const { archived, ...values } = assertHasUpdates(
    parseBody(UpdateVendorBody, req.body),
  );

  // Moving a vendor means re-placing it on the map.
  const postalCode =
    values.postalCode === undefined
      ? undefined
      : values.postalCode
        ? normalisePostalCode(values.postalCode)
        : null;

  const coords =
    postalCode === undefined ? {} : await coordinatesFor(postalCode);

  const [updated] = await db
    .update(vendorsTable)
    .set({
      ...values,
      ...(postalCode === undefined ? {} : { postalCode }),
      ...coords,
      ...(archived === undefined
        ? {}
        : { archivedAt: archived ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(eq(vendorsTable.id, existing.id))
    .returning();

  res.json(toVendorJson({ ...updated!, distanceMiles: null }));
});

/**
 * Archive rather than delete. A vendor named on a quote a family is still
 * comparing must not evaporate from that record because a director tidied
 * their directory.
 */
router.delete("/vendors/:vendorId", async (req, res) => {
  const existing = await loadVendor(req, req.params.vendorId);

  await db
    .update(vendorsTable)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(vendorsTable.id, existing.id));

  res.status(204).end();
});

/* -------------------------------------------------------------- quotes -- */

export async function quotesForCase(caseId: number, funeralHomeId: number) {
  const rows = await db
    .select({
      quote: vendorQuotesTable,
      vendorName: vendorsTable.name,
      vendorKind: vendorsTable.kind,
      vendorPhone: vendorsTable.phone,
      requestedByName: familyContactsTable.name,
    })
    .from(vendorQuotesTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, vendorQuotesTable.vendorId))
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, vendorQuotesTable.requestedByContactId),
    )
    .where(
      and(
        eq(vendorQuotesTable.caseId, caseId),
        eq(vendorQuotesTable.funeralHomeId, funeralHomeId),
      ),
    )
    .orderBy(desc(vendorQuotesTable.createdAt));

  return rows.map(({ quote, vendorName, vendorKind, vendorPhone, requestedByName }) => ({
    id: quote.id,
    caseId: quote.caseId,
    vendorId: quote.vendorId,
    vendorName,
    vendorKind,
    vendorPhone,
    request: quote.request,
    status: quote.status,
    quotedAmountCents: quote.quotedAmountCents,
    response: quote.response,
    requestedByName,
    respondedAt: quote.respondedAt,
    createdAt: quote.createdAt,
  }));
}

router.get("/cases/:caseId/quotes", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await quotesForCase(row.id, home.id));
});

router.put("/quotes/:quoteId", async (req, res) => {
  const home = tenant(req);
  const id = parseId(req.params.quoteId);
  const values = assertHasUpdates(parseBody(UpdateQuoteBody, req.body));

  const [existing] = await db
    .select()
    .from(vendorQuotesTable)
    .where(
      and(
        eq(vendorQuotesTable.id, id),
        eq(vendorQuotesTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  const found = requireRow(existing, "That quote could not be found.");

  if (values.quotedAmountCents != null && values.quotedAmountCents < 0) {
    throw badRequest("A quote can't be a negative amount.");
  }

  await db
    .update(vendorQuotesTable)
    .set({
      ...values,
      // Recording an amount or an answer is what "responded" means; there is
      // no separate button to forget to press.
      ...(values.quotedAmountCents != null || values.response
        ? { respondedAt: new Date() }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(vendorQuotesTable.id, found.id));

  const all = await quotesForCase(found.caseId, home.id);
  res.json(all.find((quote) => quote.id === found.id));
});

export default router;
