import { Router, type IRouter } from "express";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  caseDeadlinesTable,
  caseMessagesTable,
  casePhotosTable,
  casesTable,
  obituaryDraftsTable,
  serviceSelectionsTable,
  uploadsTable,
  usersTable,
  toPublicFamilyContact,
  toPublicFuneralHome,
  toStaffSignature,
  decedentDisplayName,
  MAX_PHOTOS_PER_CASE,
} from "@workspace/db";
import {
  UpdateFamilyPhotoBody,
  UpdateFamilyObituaryBody,
  SetFamilyPortraitBody,
  CreateFamilySelectionBody,
  PostFamilyMessageBody,
  CompleteFamilyDeadlineBody,
  SetFamilyAftercareConsentBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../middleware/require-family";
import { photoUpload, photosForCase, serveUpload, storeUpload, toPhotoJson } from "../lib/media";
import { buildThread, isThreadLocked, markRead } from "../lib/thread";
import { isWithinOfficeHours } from "../lib/office-hours";
import { aftercareForCase } from "../lib/aftercare";
import { deadlinesForCase } from "./deadlines";
import { nextPosition, selectionsForCase } from "./selections";

/**
 * The family portal's entire API surface.
 *
 * Note what is missing from every path below: a case id. The link token
 * names exactly one case, `requireFamilyLink` has already resolved it, and
 * handlers read it from `familyCase(req)`. There is no id for a family
 * member to tamper with and no id for a handler to forget to check — which
 * is the property that makes this surface safe to hand to an unauthenticated
 * stranger holding a forwarded text message.
 */

const router: IRouter = Router();

/* ----------------------------------------------------------- the session -- */

/**
 * Everything the portal needs to draw itself, in one call.
 *
 * This is opened on a phone, on mobile data, at a kitchen table, by someone
 * who has not slept. Four round trips before anything renders is four
 * chances to look broken, so the counts are gathered here rather than by the
 * screens that show them.
 */
router.get("/session", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);

  const [photos, deadlines, unread, obituary, lead, aftercare] = await Promise.all([
    db
      .select({ value: count() })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, row.id)),
    db
      .select({ value: count() })
      .from(caseDeadlinesTable)
      .where(
        and(
          eq(caseDeadlinesTable.caseId, row.id),
          isNull(caseDeadlinesTable.completedAt),
          eq(caseDeadlinesTable.isEvent, false),
        ),
      ),
    db
      .select({ value: count() })
      .from(caseMessagesTable)
      .where(
        and(
          eq(caseMessagesTable.caseId, row.id),
          isNull(caseMessagesTable.authorContactId),
          isNull(caseMessagesTable.readAt),
        ),
      ),
    db
      .select({ status: obituaryDraftsTable.status })
      .from(obituaryDraftsTable)
      .where(eq(obituaryDraftsTable.caseId, row.id))
      .limit(1),
    row.leadDirectorId === null
      ? Promise.resolve([])
      : db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, row.leadDirectorId))
          .limit(1),
    db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.contactId, contact.id))
      .limit(1),
  ]);

  const deliveries = aftercare[0]
    ? await db
        .select()
        .from(aftercareDeliveriesTable)
        .where(eq(aftercareDeliveriesTable.enrollmentId, aftercare[0].id))
        .orderBy(asc(aftercareDeliveriesTable.dayOffset))
    : [];

  res.json({
    contact: toPublicFamilyContact(contact),
    home: toPublicFuneralHome(home),
    case: { ...row, displayName: decedentDisplayName(row) },
    leadDirector: lead[0] ? toStaffSignature(lead[0]) : null,
    photoCount: Number(photos[0]?.value ?? 0),
    photoLimit: MAX_PHOTOS_PER_CASE,
    obituaryStatus: obituary[0]?.status ?? "family_draft",
    outstandingDeadlines: Number(deadlines[0]?.value ?? 0),
    unreadMessages: Number(unread[0]?.value ?? 0),
    messagesLocked: isThreadLocked(row),
    aftercare: aftercare[0]
      ? {
          ...aftercare[0],
          contactName: contact.name,
          // The family is shown when the check-ins would land, so they are
          // consenting to something specific rather than to "emails".
          deliveries: deliveries.map((entry) => ({
            id: entry.id,
            dayOffset: entry.dayOffset,
            dueAt: entry.dueAt,
            sentAt: entry.sentAt,
            failedAt: entry.failedAt,
          })),
        }
      : null,
  });
});

/* -------------------------------------------------------------- photos --- */

router.get("/photos", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  // Families do not see what a director has hidden. Showing someone that
  // their photograph was taken out of the slideshow, without the
  // conversation that should go with it, would be unkind.
  res.json(await photosForCase(row.id, home.id, row.portraitPhotoId, { includeHidden: false }));
});

router.post("/photos", photoUpload.single("file"), async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);

  if (!req.file) throw badRequest("Please choose a photograph.");

  // Checked here rather than trusted from the client: the limit exists so a
  // slideshow stays watchable, and a family that has already sent fifty
  // should be told plainly rather than silently having the fifty-first
  // dropped.
  const [existing] = await db
    .select({ value: count() })
    .from(casePhotosTable)
    .where(eq(casePhotosTable.caseId, row.id));

  if (Number(existing?.value ?? 0) >= MAX_PHOTOS_PER_CASE) {
    throw badRequest(
      `That's the ${MAX_PHOTOS_PER_CASE}-photograph limit. Remove one to add another, or ask the funeral home.`,
    );
  }

  const caption =
    typeof req.body?.caption === "string" ? req.body.caption.trim() : "";

  const created = await db.transaction(async (tx) => {
    const stored = await storeUpload({
      funeralHomeId: home.id,
      caseId: row.id,
      uploadedByContactId: contact.id,
      file: req.file!,
      // Same transaction as the photo row below: if that insert fails, the
      // bytes must go with it rather than linger unreferenced.
      tx,
    });

    const [photo] = await tx
      .insert(casePhotosTable)
      .values({
        funeralHomeId: home.id,
        caseId: row.id,
        uploadId: stored.id,
        uploadedByContactId: contact.id,
        caption: caption || null,
        position: Number(existing?.value ?? 0),
      })
      .returning();

    return photo!;
  });

  res.status(201).json(
    toPhotoJson(created, {
      portraitPhotoId: row.portraitPhotoId,
      uploadedByName: contact.name,
    }),
  );
});

/** Load a photograph, scoped to this family's own case. */
async function loadFamilyPhoto(req: Parameters<typeof familyCase>[0] & { params: Record<string, string | undefined> }) {
  const row = familyCase(req);
  const id = parseId(req.params.photoId);

  const [photo] = await db
    .select()
    .from(casePhotosTable)
    .where(and(eq(casePhotosTable.id, id), eq(casePhotosTable.caseId, row.id)))
    .limit(1);

  return requireRow(photo, "That photograph could not be found.");
}

router.patch("/photos/:photoId", async (req, res) => {
  const row = familyCase(req);
  const photo = await loadFamilyPhoto(req as never);
  const values = assertHasUpdates(parseBody(UpdateFamilyPhotoBody, req.body));

  const [updated] = await db
    .update(casePhotosTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(casePhotosTable.id, photo.id))
    .returning();

  res.json(toPhotoJson(updated!, { portraitPhotoId: row.portraitPhotoId }));
});

/**
 * A family member may remove a photograph they sent, but not one somebody
 * else sent. Deleting a cousin's picture of their own aunt is not a decision
 * that belongs to whoever opened the link most recently; that one goes
 * through the director.
 */
router.delete("/photos/:photoId", async (req, res) => {
  const contact = familyContact(req);
  const home = familyHome(req);
  const photo = await loadFamilyPhoto(req as never);

  if (photo.uploadedByContactId !== contact.id) {
    throw new HttpError(
      403,
      "Only the person who added this photograph can remove it. Ask the funeral home if you need it taken out.",
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(casesTable)
      .set({ portraitPhotoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(casesTable.id, photo.caseId),
          eq(casesTable.portraitPhotoId, photo.id),
        ),
      );
    await tx.delete(casePhotosTable).where(eq(casePhotosTable.id, photo.id));
    await tx
      .delete(uploadsTable)
      .where(
        and(
          eq(uploadsTable.id, photo.uploadId),
          eq(uploadsTable.funeralHomeId, home.id),
        ),
      );
  });

  res.status(204).end();
});

/** Choose the portrait, and store the crop as instructions on the photo. */
router.put("/portrait", async (req, res) => {
  const row = familyCase(req);
  const values = parseBody(SetFamilyPortraitBody, req.body);

  const [photo] = await db
    .select()
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.id, values.photoId),
        eq(casePhotosTable.caseId, row.id),
      ),
    )
    .limit(1);

  const found = requireRow(photo, "That photograph could not be found.");

  const [updated] = await db.transaction(async (tx) => {
    await tx
      .update(casesTable)
      .set({ portraitPhotoId: found.id, updatedAt: new Date() })
      .where(eq(casesTable.id, row.id));

    return tx
      .update(casePhotosTable)
      .set({
        cropX: values.cropX ?? found.cropX,
        cropY: values.cropY ?? found.cropY,
        cropWidth: values.cropWidth ?? found.cropWidth,
        cropHeight: values.cropHeight ?? found.cropHeight,
        updatedAt: new Date(),
      })
      .where(eq(casePhotosTable.id, found.id))
      .returning();
  });

  res.json(toPhotoJson(updated!, { portraitPhotoId: found.id }));
});

/* ------------------------------------------------------------ obituary --- */

async function loadFamilyDraft(caseId: number) {
  const [row] = await db
    .select()
    .from(obituaryDraftsTable)
    .where(eq(obituaryDraftsTable.caseId, caseId))
    .limit(1);

  return requireRow(row, "That obituary could not be found.");
}

router.get("/obituary", async (req, res) => {
  res.json(await loadFamilyDraft(familyCase(req).id));
});

router.put("/obituary", async (req, res) => {
  const row = familyCase(req);
  const existing = await loadFamilyDraft(row.id);
  const values = assertHasUpdates(parseBody(UpdateFamilyObituaryBody, req.body));

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

  res.json(updated);
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
    res.json(existing);
    return;
  }

  const [updated] = await db
    .update(obituaryDraftsTable)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(obituaryDraftsTable.id, existing.id))
    .returning();

  res.json(updated);
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

/* ------------------------------------------------------------ messages --- */

router.get("/messages", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  const thread = await buildThread({ case: row, home });

  void markRead(row.id, "family").catch((err: unknown) => {
    req.log?.warn({ err }, "Could not mark home messages read");
  });

  res.json(thread);
});

router.post("/messages", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);
  const values = parseBody(PostFamilyMessageBody, req.body);

  const body = values.body.trim();
  if (!body) throw badRequest("A message can't be empty.");

  if (isThreadLocked(row)) {
    throw new HttpError(
      409,
      "This conversation has been closed. Please call the funeral home if you need them.",
    );
  }

  const now = new Date();
  // Delivered whatever the hour — see `lib/office-hours.ts`. All that is
  // recorded is that it was written out of hours, so the portal can say
  // honestly when it will be read.
  const outsideHours = isWithinOfficeHours(home, now) ? null : now;

  const [created] = await db
    .insert(caseMessagesTable)
    .values({
      funeralHomeId: home.id,
      caseId: row.id,
      authorContactId: contact.id,
      body,
      sentOutsideOfficeHours: outsideHours,
    })
    .returning();

  res.status(201).json({
    id: created!.id,
    caseId: created!.caseId,
    body: created!.body,
    authorSide: "family" as const,
    authorName: contact.name,
    authorTitle: contact.relationship,
    sentOutsideOfficeHours: outsideHours !== null,
    readAt: created!.readAt,
    createdAt: created!.createdAt,
  });
});

/* ----------------------------------------------------------- deadlines --- */

router.get("/deadlines", async (req, res) => {
  const row = familyCase(req);
  res.json(await deadlinesForCase(row.id, row.funeralHomeId));
});

router.post("/deadlines/:deadlineId", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const id = parseId(req.params.deadlineId);
  const { completed } = parseBody(CompleteFamilyDeadlineBody, req.body);

  const [deadline] = await db
    .select()
    .from(caseDeadlinesTable)
    .where(
      and(eq(caseDeadlinesTable.id, id), eq(caseDeadlinesTable.caseId, row.id)),
    )
    .limit(1);

  const found = requireRow(deadline, "That could not be found.");

  if (found.isEvent) {
    throw badRequest("That's when something happens, not something to do.");
  }

  await db
    .update(caseDeadlinesTable)
    .set(
      completed
        ? {
            completedAt: new Date(),
            completedByContactId: contact.id,
            completedByUserId: null,
            updatedAt: new Date(),
          }
        : {
            completedAt: null,
            completedByContactId: null,
            completedByUserId: null,
            updatedAt: new Date(),
          },
    )
    .where(eq(caseDeadlinesTable.id, found.id));

  const all = await deadlinesForCase(row.id, row.funeralHomeId);
  res.json(all.find((entry) => entry.id === found.id));
});

/* ----------------------------------------------------------- aftercare --- */

/**
 * Say yes or no to the check-ins.
 *
 * "No" writes `unsubscribedAt` and is final — there is no re-prompt, and
 * nothing else in this codebase sets that column back to null. A grieving
 * family that has said no once must never be asked again by software.
 */
router.post("/aftercare", async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const values = parseBody(SetFamilyAftercareConsentBody, req.body);

  const [existing] = await db
    .select()
    .from(aftercareEnrollmentsTable)
    .where(eq(aftercareEnrollmentsTable.contactId, contact.id))
    .limit(1);

  const found = requireRow(
    existing,
    "There is no aftercare on this case yet.",
  );

  const now = new Date();

  const [updated] = await db
    .update(aftercareEnrollmentsTable)
    .set(
      values.consent
        ? {
            status: "active",
            consentedAt: now,
            unsubscribedAt: null,
            ...(values.email ? { email: values.email } : {}),
            updatedAt: now,
          }
        : { status: "done", unsubscribedAt: now, updatedAt: now },
    )
    .where(eq(aftercareEnrollmentsTable.id, found.id))
    .returning();

  const all = await aftercareForCase(row.id, row.funeralHomeId);
  res.json(
    all.find((entry) => entry.id === updated!.id) ?? {
      ...updated!,
      contactName: contact.name,
      deliveries: [],
    },
  );
});

/* ------------------------------------------------------------- uploads --- */

router.get("/uploads/:uploadId", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  // Scoped to this case, plus the home's logo and nothing else. However the
  // id is mangled, no other family's file is reachable.
  await serveUpload(res, {
    uploadId: parseId(req.params.uploadId),
    funeralHomeId: home.id,
    caseId: row.id,
    logoUploadId: home.logoUploadId,
  });
});

export default router;
