import {
  CreateFamilyBelongingBody,
  CreateFamilySelectionBody,
  GetFamilyVendorsQueryParams,
  RequestFamilyQuoteBody,
  SetFamilyPostalCodeBody,
  UpdateFamilyBelongingBody,
  UpdateFamilyObituaryBody,
  UpdateFamilyPreparationBody,
  UpdateFamilyVitalsBody,
} from "@workspace/api-zod";
import type { ObituaryDraft } from "@workspace/db";
import {
  caseBelongingsTable,
  casePreparationTable,
  casesTable,
  db,
  normalisePostalCode,
  obituaryDraftsTable,
  serviceSelectionsTable,
  vendorQuotesTable,
  vendorsTable,
  vitalStatisticsTable,
} from "@workspace/db";
import { and, eq, max } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  belongingsForCase,
  ensureBelongingPrompts,
  preparationForCase,
  toPreparationJson,
} from "../../lib/belongings";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  parseQuery,
  requireRow,
} from "../../lib/http";
import { obituaryHints } from "../../lib/obituary";
import { findVendors, locate, toVendorJson } from "../../lib/vendors";
import {
  encryptSsn,
  pickWritable,
  toVitalsJson,
  vitalsForCase,
} from "../../lib/vitals";
import { familyCase, familyContact } from "../../middleware/require-family";
import { checkPronouns } from "../obituary";
import { nextPosition, selectionsForCase } from "../selections";
import { quotesForCase } from "../vendors";

/** The obituary, the selections, belongings, preparation, the local network and vital statistics, as the family sees them. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* ------------------------------------------------------------ obituary --- */

async function loadFamilyDraft(caseId: number) {
  const [row] = await db
    .select()
    .from(obituaryDraftsTable)
    .where(eq(obituaryDraftsTable.caseId, caseId))
    .limit(1);

  return requireRow(row, "That obituary could not be found.");
}

/** The family's view: the fields and hints, never a staff suggestion. */
function toFamilyObituaryJson(draft: ObituaryDraft) {
  const { aiSuggestion, aiSuggestedAt, aiSuggestedByUserId, ...rest } = draft;
  void aiSuggestion;
  void aiSuggestedAt;
  void aiSuggestedByUserId;
  return { ...rest, hints: obituaryHints(draft) };
}

router.get("/obituary", async (req, res) => {
  res.json(toFamilyObituaryJson(await loadFamilyDraft(familyCase(req).id)));
});

router.put("/obituary", async (req, res) => {
  const row = familyCase(req);
  const existing = await loadFamilyDraft(row.id);
  const values = assertHasUpdates(
    parseBody(UpdateFamilyObituaryBody, req.body),
  );
  checkPronouns(values);

  // Once it has gone to the printer, an uncle changing a date would produce
  // cards that do not match the service.
  if (existing.status === "approved") {
    throw new HttpError(
      409,
      "The funeral home has approved this obituary for print. Send them a message if something needs changing.",
    );
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toFamilyObituaryJson(updated!));
});

/**
 * Hand it to the director.
 *
 * Not a lock. A family that presses this and then remembers a grandchild can
 * still edit — the status is a signal to the director that it is worth
 * reading, not a door closing on people who are not thinking clearly.
 */
router.post("/obituary/submit", async (req, res) => {
  const existing = await loadFamilyDraft(familyCase(req).id);

  if (existing.status === "approved") {
    res.json(toFamilyObituaryJson(existing));
    return;
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(toFamilyObituaryJson(updated!));
});

/* ---------------------------------------------------------- selections --- */

router.get("/selections", async (req, res) => {
  const row = familyCase(req);
  res.json(await selectionsForCase(row.id, row.funeralHomeId));
});

router.post("/selections", async (req, res) => {
  const row = familyCase(req);
  const values = parseBody(CreateFamilySelectionBody, req.body);

  const value = values.value.trim();
  if (!value) throw badRequest("That can't be empty.");

  const [created] = await db
    .insert(serviceSelectionsTable)
    .values({
      funeralHomeId: row.funeralHomeId,
      caseId: row.id,
      kind: values.kind,
      value,
      notes: values.notes ?? null,
      attribution: values.attribution ?? null,
      position: await nextPosition(row.id, row.funeralHomeId, values.kind),
    })
    .returning();

  res.status(201).json(created);
});

/**
 * Only while it is still the family's to change. Once the director has
 * confirmed a hymn it is in the order of service at the printer, and
 * removing it here would leave the two out of step silently.
 */
router.delete("/selections/:selectionId", async (req, res) => {
  const row = familyCase(req);
  const id = parseId(req.params.selectionId);

  const [selection] = await db
    .select()
    .from(serviceSelectionsTable)
    .where(
      and(
        eq(serviceSelectionsTable.id, id),
        eq(serviceSelectionsTable.caseId, row.id),
      ),
    )
    .limit(1);

  const found = requireRow(selection, "That selection could not be found.");

  if (found.confirmedAt !== null) {
    throw new HttpError(
      409,
      "The funeral home has already confirmed this one. Send them a message if it needs to change.",
    );
  }

  await db
    .delete(serviceSelectionsTable)
    .where(eq(serviceSelectionsTable.id, found.id));

  res.status(204).end();
});

/* ---------------------------------------------------------- belongings --- */

router.get("/belongings", async (req, res) => {
  const row = familyCase(req);
  await ensureBelongingPrompts(row.id, row.funeralHomeId);
  res.json(await belongingsForCase(row.id, row.funeralHomeId));
});

router.post("/belongings", async (req, res) => {
  const row = familyCase(req);
  const values = parseBody(CreateFamilyBelongingBody, req.body);

  const description = values.description.trim();
  if (!description) throw badRequest("Please say what the item is.");

  const [last] = await db
    .select({ value: max(caseBelongingsTable.position) })
    .from(caseBelongingsTable)
    .where(eq(caseBelongingsTable.caseId, row.id));

  const [created] = await db
    .insert(caseBelongingsTable)
    .values({
      funeralHomeId: row.funeralHomeId,
      caseId: row.id,
      kind: values.kind ?? "other",
      description,
      disposition: values.disposition ?? "undecided",
      notes: values.notes ?? null,
      position: (last?.value ?? -1) + 1,
    })
    .returning();

  const all = await belongingsForCase(row.id, row.funeralHomeId);
  res.status(201).json(all.find((item) => item.id === created!.id));
});

/**
 * A family may describe an item and say what should happen to it. They cannot
 * move it through the chain of custody: only the home records that something
 * was received or handed back, because the home is what a family relies on
 * when a wedding ring cannot be found.
 */
router.put("/belongings/:belongingId", async (req, res) => {
  const row = familyCase(req);
  const id = parseId(req.params.belongingId);
  const values = assertHasUpdates(
    parseBody(UpdateFamilyBelongingBody, req.body),
  );

  const [item] = await db
    .select()
    .from(caseBelongingsTable)
    .where(
      and(
        eq(caseBelongingsTable.id, id),
        eq(caseBelongingsTable.caseId, row.id),
      ),
    )
    .limit(1);

  const found = requireRow(item, "That item could not be found.");

  // Once the home is holding it, its description is the home's record.
  if (found.receivedAt !== null) {
    throw new HttpError(
      409,
      "The funeral home already has this one. Send them a message if something needs changing.",
    );
  }

  await db
    .update(caseBelongingsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(caseBelongingsTable.id, found.id));

  const all = await belongingsForCase(row.id, row.funeralHomeId);
  res.json(all.find((entry) => entry.id === found.id));
});

router.delete("/belongings/:belongingId", async (req, res) => {
  const row = familyCase(req);
  const id = parseId(req.params.belongingId);

  const [item] = await db
    .select()
    .from(caseBelongingsTable)
    .where(
      and(
        eq(caseBelongingsTable.id, id),
        eq(caseBelongingsTable.caseId, row.id),
      ),
    )
    .limit(1);

  const found = requireRow(item, "That item could not be found.");

  if (found.receivedAt !== null) {
    throw new HttpError(
      409,
      "The funeral home already has this one, so its record stays.",
    );
  }

  await db
    .delete(caseBelongingsTable)
    .where(eq(caseBelongingsTable.id, found.id));

  res.status(204).end();
});

/* --------------------------------------------------------- preparation --- */

router.get("/preparation", async (req, res) => {
  const row = familyCase(req);
  const sheet = await preparationForCase(row.id, row.funeralHomeId);
  res.json(await toPreparationJson(sheet, row.referencePhotoId));
});

router.put("/preparation", async (req, res) => {
  const row = familyCase(req);
  const sheet = await preparationForCase(row.id, row.funeralHomeId);
  const values = assertHasUpdates(
    parseBody(UpdateFamilyPreparationBody, req.body),
  );

  // Editing after staff have signed the sheet off resets that: what the
  // preparation room read is no longer what the family has said. Only a real
  // change does — a save that repeats what is on file (a stale tab, a
  // double tap) leaves the sign-off standing.
  const changed = Object.entries(values).some(
    ([key, value]) =>
      (sheet as Record<string, unknown>)[key] !== (value ?? null),
  );

  const [updated] = await db
    .update(casePreparationTable)
    .set({
      ...values,
      ...(changed ? { reviewedAt: null, reviewedByUserId: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(casePreparationTable.id, sheet.id))
    .returning();

  res.json(await toPreparationJson(updated!, row.referencePhotoId));
});

/* -------------------------------------------------------------- local --- */

/**
 * Where the family is.
 *
 * The one piece of information that makes "local" mean anything, asked once,
 * on the screen where it is obviously needed rather than buried in a profile
 * nobody fills in. Their ZIP rather than the home's, because a daughter
 * arranging her mother's funeral from two states away needs monument
 * companies near the cemetery, not near her.
 */
router.put("/postal-code", async (req, res) => {
  const row = familyCase(req);
  const { postalCode } = parseBody(SetFamilyPostalCodeBody, req.body);

  const normalised = normalisePostalCode(postalCode);

  if (!normalised) {
    throw badRequest("That doesn't look like a ZIP code.");
  }

  await db
    .update(casesTable)
    .set({ postalCode: normalised, updatedAt: new Date() })
    .where(eq(casesTable.id, row.id));

  // Said plainly, because an unrecognised ZIP means distances will be
  // missing and the family should know that rather than wonder.
  const known = await locate(normalised);

  res.json({ postalCode: normalised, recognised: known !== null });
});

router.get("/vendors", async (req, res) => {
  const row = familyCase(req);
  const query = parseQuery(GetFamilyVendorsQueryParams, req.query);

  const rows = await findVendors({
    funeralHomeId: row.funeralHomeId,
    kind: query.kind,
    // The case's own ZIP, so the family never types it twice.
    near: row.postalCode ?? undefined,
    // Only what the home has chosen to put in front of families.
    visibleOnly: true,
  });

  res.json(rows.map(toVendorJson));
});

router.get("/quotes", async (req, res) => {
  const row = familyCase(req);
  res.json(await quotesForCase(row.id, row.funeralHomeId));
});

/**
 * Ask the home to get a price.
 *
 * The family never contacts the vendor through us and no money moves here.
 * This is an introduction with a record kept, so that three headstone quotes
 * can be compared later without anyone having to remember three phone calls
 * made in the worst week of their life.
 */
router.post("/quotes", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const values = parseBody(RequestFamilyQuoteBody, req.body);

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.id, values.vendorId),
        eq(vendorsTable.funeralHomeId, row.funeralHomeId),
        // A family may only ask about someone the home actually shows them.
        eq(vendorsTable.visibleToFamily, true),
      ),
    )
    .limit(1);

  const found = requireRow(vendor, "That one could not be found.");

  const [created] = await db
    .insert(vendorQuotesTable)
    .values({
      funeralHomeId: row.funeralHomeId,
      caseId: row.id,
      vendorId: found.id,
      requestedByContactId: contact.id,
      request: values.request?.trim() || null,
    })
    .returning();

  const all = await quotesForCase(row.id, row.funeralHomeId);
  res.status(201).json(all.find((quote) => quote.id === created!.id));
});

/* -------------------------------------------------------------- vitals --- */

/**
 * What the death certificate needs.
 *
 * The most deadline-driven paperwork in the process, and almost none of it is
 * known to the funeral director — it is known to a daughter who has to ring
 * an aunt about a maiden name and find a discharge certificate in a drawer.
 * That is research, not a conversation, which is why it goes badly across a
 * desk and fine at home over two evenings.
 *
 * Saved field by field with nothing required, so somebody can answer the
 * three things they know at eleven at night and come back.
 */
router.get("/vitals", async (req, res) => {
  const row = familyCase(req);
  res.json(await toVitalsJson(await vitalsForCase(row.id, row.funeralHomeId)));
});

router.put("/vitals", async (req, res) => {
  const row = familyCase(req);
  const existing = await vitalsForCase(row.id, row.funeralHomeId);

  // Once staff have checked it against documents, a later edit would mean
  // the verified record and the family's answers disagree silently.
  if (existing.status === "verified") {
    throw new HttpError(
      409,
      "The funeral home has already checked these details. Send them a message if something needs correcting.",
    );
  }

  const body = assertHasUpdates(parseBody(UpdateFamilyVitalsBody, req.body));
  const values = pickWritable(body as Record<string, unknown>);

  const touchedSsn = Object.prototype.hasOwnProperty.call(
    body,
    "socialSecurityNumber",
  );

  if (touchedSsn) {
    const digits = (body.socialSecurityNumber ?? "").replace(/\D/g, "");
    if (digits.length > 0 && digits.length !== 9) {
      throw badRequest("A social security number has nine digits.");
    }
  }

  const [updated] = await db
    .update(vitalStatisticsTable)
    .set({
      ...values,
      ...(touchedSsn
        ? { socialSecurityNumber: encryptSsn(body.socialSecurityNumber) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(vitalStatisticsTable.id, existing.id))
    .returning();

  res.json(await toVitalsJson(updated!));
});

/**
 * Not a lock. A family who presses this and then finds the discharge papers
 * can still add them — the status tells the director it is worth reading,
 * rather than closing a door on people who are not thinking clearly.
 */
router.post("/vitals/submit", async (req, res) => {
  const row = familyCase(req);
  const existing = await vitalsForCase(row.id, row.funeralHomeId);

  if (existing.status === "verified") {
    res.json(await toVitalsJson(existing));
    return;
  }

  const [updated] = await db
    .update(vitalStatisticsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vitalStatisticsTable.id, existing.id))
    .returning();

  res.json(await toVitalsJson(updated!));
});

export default router;
