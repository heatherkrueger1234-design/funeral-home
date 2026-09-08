import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  casePhotosTable,
  casesTable,
  uploadsTable,
  familyContactsTable,
  decedentDisplayName,
  type CasePhoto,
} from "@workspace/db";
import {
  UpdatePhotoBody,
  ReorderCasePhotosBody,
  SetPhotoSelectionBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { tenant } from "../middleware/require-auth";
import { photosForCase, setSelection, toPhotoJson } from "../lib/media";
import { decryptBuffer } from "@workspace/db/crypto";
import { ZipWriter } from "../lib/zip";
import { loadCase } from "./cases";

const router: IRouter = Router();

async function loadPhoto(
  req: Parameters<typeof tenant>[0],
  rawId: string | undefined,
): Promise<CasePhoto> {
  const home = tenant(req);
  const id = parseId(rawId);

  const [row] = await db
    .select()
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.id, id),
        eq(casePhotosTable.funeralHomeId, home.id),
      ),
    )
    .limit(1);

  return requireRow(row, "That photograph could not be found.");
}

router.get("/cases/:caseId/photos", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  // Staff see hidden photographs too — a director needs to know what was
  // taken out of the slideshow, and by whom.
  res.json(
    await photosForCase(row.id, home.id, row.portraitPhotoId, {
      includeHidden: true,
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

/**
 * Choose what runs in the chapel.
 *
 * The bin holds everything the family sent -- which for a family that went
 * through every album in the house can be several hundred. This is the cut,
 * and it is made here rather than at the door.
 */
router.put("/cases/:caseId/photos/selection", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { photoIds } = parseBody(SetPhotoSelectionBody, req.body);

  await setSelection({ caseId: row.id, funeralHomeId: home.id, photoIds });

  res.json(
    await photosForCase(row.id, home.id, row.portraitPhotoId, {
      includeHidden: true,
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

/**
 * Set the slideshow order.
 *
 * Positions are rewritten from the given order rather than accepting an
 * arbitrary position per photograph, so the result cannot end up with two
 * photographs claiming the same slot.
 */
router.put("/cases/:caseId/photos/order", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const { photoIds } = parseBody(ReorderCasePhotosBody, req.body);

  const existing = await db
    .select({ id: casePhotosTable.id })
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.caseId, row.id),
        eq(casePhotosTable.funeralHomeId, home.id),
      ),
    );

  const known = new Set(existing.map((photo) => photo.id));
  const seen = new Set<number>();

  for (const id of photoIds) {
    if (!known.has(id)) throw badRequest("That photograph is not on this case.");
    if (seen.has(id)) throw badRequest("A photograph was listed twice.");
    seen.add(id);
  }

  await db.transaction(async (tx) => {
    for (const [index, id] of photoIds.entries()) {
      await tx
        .update(casePhotosTable)
        .set({ position: index, updatedAt: new Date() })
        .where(eq(casePhotosTable.id, id));
    }
  });

  res.json(
    await photosForCase(row.id, home.id, row.portraitPhotoId, {
      includeHidden: true,
      referencePhotoId: row.referencePhotoId,
    }),
  );
});

router.patch("/photos/:photoId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPhoto(req, req.params.photoId);
  const values = assertHasUpdates(parseBody(UpdatePhotoBody, req.body));

  const [updated] = await db
    .update(casePhotosTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(casePhotosTable.id, existing.id))
    .returning();

  const [row] = await db
    .select({
      portraitPhotoId: casesTable.portraitPhotoId,
      referencePhotoId: casesTable.referencePhotoId,
    })
    .from(casesTable)
    .where(eq(casesTable.id, existing.caseId))
    .limit(1);

  res.json(
    toPhotoJson(updated!, {
      portraitPhotoId: row?.portraitPhotoId ?? null,
      referencePhotoId: row?.referencePhotoId ?? null,
    }),
  );
});

/**
 * Delete a photograph and the bytes behind it.
 *
 * If it was the portrait, the case's pointer is cleared in the same
 * transaction — a case pointing at a deleted photograph would render the
 * register book with a hole in it.
 */
router.delete("/photos/:photoId", async (req, res) => {
  const home = tenant(req);
  const existing = await loadPhoto(req, req.params.photoId);

  await db.transaction(async (tx) => {
    // Both pointers, or the register book renders with a hole in it and the
    // preparation room is handed a reference photo that no longer exists.
    await tx
      .update(casesTable)
      .set({ portraitPhotoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(casesTable.id, existing.caseId),
          eq(casesTable.portraitPhotoId, existing.id),
        ),
      );

    await tx
      .update(casesTable)
      .set({ referencePhotoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(casesTable.id, existing.caseId),
          eq(casesTable.referencePhotoId, existing.id),
        ),
      );

    await tx.delete(casePhotosTable).where(eq(casePhotosTable.id, existing.id));
    // The photo row references the upload with `cascade`, so the bytes have
    // to go explicitly rather than being orphaned in the uploads table.
    await tx
      .delete(uploadsTable)
      .where(
        and(
          eq(uploadsTable.id, existing.uploadId),
          eq(uploadsTable.funeralHomeId, home.id),
        ),
      );
  });

  res.status(204).end();
});

/**
 * The photo pack: everything the family collected, as a folder.
 *
 * This is the moment the subscription justifies itself. Without it a director
 * finishes the collection step and then saves forty images by hand, in a
 * guessed order, from a web page -- which is most of the time the tool was
 * supposed to save. So: numbered in slideshow order, named with the caption
 * the family wrote, with a `captions.txt` for whoever is typesetting the
 * order of service.
 *
 * Streamed a file at a time rather than assembled in memory. Fifty
 * photographs at 15 MB is 750 MB, and buffering that per concurrent download
 * is how a small server falls over on the morning everyone is preparing
 * Saturday's funerals.
 */
router.get("/cases/:caseId/photo-pack", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);

  const rows = await db
    .select({ photo: casePhotosTable, uploadedByName: familyContactsTable.name })
    .from(casePhotosTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, casePhotosTable.uploadedByContactId),
    )
    .where(
      and(
        eq(casePhotosTable.caseId, row.id),
        eq(casePhotosTable.funeralHomeId, home.id),
        // What a director hid is not in the slideshow, so it is not in the
        // pack either -- otherwise hiding it achieved nothing.
        eq(casePhotosTable.status, "visible"),
        /*
         * The pack is the slideshow, not the bin.
         *
         * A family may have uploaded four hundred photographs; the director
         * needs the fifty that were chosen, in the order they were chosen.
         * Handing over the whole bin would put the editing work straight back
         * on them, which is the thing this feature exists to remove.
         */
        eq(casePhotosTable.selected, true),
      ),
    );

  if (rows.length === 0) {
    throw badRequest(
      "No photographs have been chosen for the slideshow yet. Pick the ones to include first.",
    );
  }

  rows.sort(
    (a, b) => a.photo.position - b.photo.position || a.photo.id - b.photo.id,
  );

  const name = decedentDisplayName(row).replace(/[^a-zA-Z0-9]+/g, "-");
  const filename = `${name || "photographs"}-photographs.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");

  const zip = new ZipWriter(res);
  const manifest: string[] = [
    decedentDisplayName(row),
    row.serviceAt ? `Service: ${row.serviceAt.toISOString()}` : "",
    "",
  ].filter(Boolean);

  for (const [index, { photo, uploadedByName }] of rows.entries()) {
    const [upload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, photo.uploadId))
      .limit(1);

    if (!upload) continue;

    let bytes: Buffer;
    try {
      bytes = decryptBuffer(upload.data);
    } catch {
      // One unreadable file must not abort a download the director is
      // waiting on; it is recorded in the manifest instead.
      manifest.push(`${String(index + 1).padStart(2, "0")}. [could not be read]`);
      continue;
    }

    const order = String(index + 1).padStart(2, "0");
    const extension = upload.filename.includes(".")
      ? upload.filename.slice(upload.filename.lastIndexOf(".") + 1)
      : "jpg";
    const caption = photo.caption?.trim();
    const label = caption ? `-${caption.replace(/[^a-zA-Z0-9]+/g, "-")}` : "";

    await zip.addFile(
      ZipWriter.safeName(`${order}${label}.${extension}`.slice(0, 120)),
      bytes,
      upload.createdAt,
    );

    manifest.push(
      `${order}. ${caption || "(no caption)"}${uploadedByName ? ` — from ${uploadedByName}` : ""}`,
    );
  }

  await zip.addFile("captions.txt", Buffer.from(manifest.join("\n"), "utf8"));
  await zip.finish();

  // `finish` writes the central directory; ending the response is the
  // caller's job, and without it the browser waits forever on an archive
  // that is already complete on the wire.
  res.end();
});

export default router;
