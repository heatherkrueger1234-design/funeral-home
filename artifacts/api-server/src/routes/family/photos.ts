import {
  SetFamilyPhotoSelectionBody,
  SetFamilyPortraitBody,
  SetFamilyReferencePhotoBody,
  UpdateFamilyPhotoBody,
} from "@workspace/api-zod";
import { casePhotosTable, casesTable, db, uploadsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  assertHasUpdates,
  HttpError,
  parseBody,
  parseId,
  requireRow,
} from "../../lib/http";
import {
  addPhotoToCase,
  mergeCrop,
  photosForCase,
  photoUpload,
  setSelection,
  toPhotoJson,
} from "../../lib/media";
import {
  familyCase,
  familyContact,
  familyHome,
} from "../../middleware/require-family";
import { PhotoDatingBody } from "../memory-book";

/** The family's photographs. Mounted under /family; see `index.ts`. */
const router: IRouter = Router();

/* -------------------------------------------------------------- photos --- */

router.get("/photos", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);

  // Families do not see what a director has hidden. Showing someone that
  // their photograph was taken out of the slideshow, without the
  // conversation that should go with it, would be unkind.
  res.json(
    await photosForCase(row.id, home.id, row.portraitPhotoId, {
      includeHidden: false,
      audience: "family",
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

router.post("/photos", photoUpload.single("file"), async (req, res) => {
  const contact = familyContact(req);
  const row = familyCase(req);
  const home = familyHome(req);

  // The same path the director's Photos panel uses, so a print scanned at
  // the office and a phone photograph from the family are checked, converted
  // and counted against the bin identically. See `addPhotoToCase`.
  const created = await addPhotoToCase({
    funeralHomeId: home.id,
    caseId: row.id,
    file: req.file,
    caption: req.body?.caption,
    by: { contactId: contact.id },
  });

  res.status(201).json(
    toPhotoJson(created, {
      portraitPhotoId: row.portraitPhotoId,
      referencePhotoId: row.referencePhotoId,
      uploadedByName: contact.name,
    }),
  );
});

/** Load a photograph, scoped to this family's own case. */
async function loadFamilyPhoto(
  req: Parameters<typeof familyCase>[0] & {
    params: Record<string, string | undefined>;
  },
) {
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
  /*
   * The family dates their own photographs, and they are the only people
   * who can: a director has never seen the back of the print. This is what
   * makes the age progression in the memory book possible at all.
   */
  // `parseBody` for both halves: a bare `.parse` threw a ZodError that no
  // handler recognised, so a year typed as "1970s" came back as a 500.
  const values = assertHasUpdates({
    ...parseBody(UpdateFamilyPhotoBody, req.body),
    ...parseBody(PhotoDatingBody, req.body),
  });

  const [updated] = await db
    .update(casePhotosTable)
    .set({ ...values, ...mergeCrop(photo, values), updatedAt: new Date() })
    .where(eq(casePhotosTable.id, photo.id))
    .returning();

  res.json(
    toPhotoJson(updated!, {
      portraitPhotoId: row.portraitPhotoId,
      referencePhotoId: row.referencePhotoId,
    }),
  );
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
    await tx
      .update(casesTable)
      .set({ referencePhotoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(casesTable.id, photo.caseId),
          eq(casesTable.referencePhotoId, photo.id),
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

/**
 * Choose which photographs run in the chapel.
 *
 * The family is the right person to make this cut -- they know which three of
 * the seven Christmas pictures is the one -- and the portal shows them a
 * count against a recommended fifty rather than refusing the fifty-first.
 */
router.put("/photos/selection", async (req, res) => {
  const row = familyCase(req);
  const home = familyHome(req);
  const { photoIds } = parseBody(SetFamilyPhotoSelectionBody, req.body);

  await setSelection({
    caseId: row.id,
    funeralHomeId: home.id,
    photoIds,
  });

  res.json(
    await photosForCase(row.id, home.id, row.portraitPhotoId, {
      includeHidden: false,
      audience: "family",
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

/**
 * The photograph handed to whoever does hair and cosmetics.
 *
 * Kept separate from the portrait on purpose: the portrait is the one the
 * family loves, which is often decades old and in profile; the preparation
 * room needs a clear recent front-on face. Asking for it here is what stops a
 * director having to ring a daughter to ask how her mother wore her hair.
 */
router.put("/reference-photo", async (req, res) => {
  const row = familyCase(req);
  const { photoId } = parseBody(SetFamilyReferencePhotoBody, req.body);

  const [photo] = await db
    .select()
    .from(casePhotosTable)
    .where(
      and(eq(casePhotosTable.id, photoId), eq(casePhotosTable.caseId, row.id)),
    )
    .limit(1);

  const found = requireRow(photo, "That photograph could not be found.");

  await db
    .update(casesTable)
    .set({ referencePhotoId: found.id, updatedAt: new Date() })
    .where(eq(casesTable.id, row.id));

  res.json(
    toPhotoJson(found, {
      portraitPhotoId: row.portraitPhotoId,
      referencePhotoId: found.id,
    }),
  );
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
  // Checked before anything is written, so a bad framing does not still move
  // the portrait to this photograph.
  const crop = mergeCrop(found, values);

  const [updated] = await db.transaction(async (tx) => {
    await tx
      .update(casesTable)
      .set({ portraitPhotoId: found.id, updatedAt: new Date() })
      .where(eq(casesTable.id, row.id));

    return tx
      .update(casePhotosTable)
      .set({ ...crop, updatedAt: new Date() })
      .where(eq(casePhotosTable.id, found.id))
      .returning();
  });

  res.json(
    toPhotoJson(updated!, {
      portraitPhotoId: found.id,
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

export default router;
