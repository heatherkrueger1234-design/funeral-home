import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, casePhotosTable, casesTable, uploadsTable, type CasePhoto } from "@workspace/db";
import { UpdatePhotoBody, ReorderCasePhotosBody } from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { tenant } from "../middleware/require-auth";
import { photosForCase, toPhotoJson } from "../lib/media";
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
  res.json(await photosForCase(row.id, home.id, row.portraitPhotoId, { includeHidden: true }));
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

  res.json(await photosForCase(row.id, home.id, row.portraitPhotoId, { includeHidden: true }));
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
    .select({ portraitPhotoId: casesTable.portraitPhotoId })
    .from(casesTable)
    .where(eq(casesTable.id, existing.caseId))
    .limit(1);

  res.json(
    toPhotoJson(updated!, { portraitPhotoId: row?.portraitPhotoId ?? null }),
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
    await tx
      .update(casesTable)
      .set({ portraitPhotoId: null, updatedAt: new Date() })
      .where(
        and(
          eq(casesTable.id, existing.caseId),
          eq(casesTable.portraitPhotoId, existing.id),
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

export default router;
