import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, albumsTable, albumItemsTable, memoriesTable, uploadsTable } from "@workspace/db";
import {
  CreateAlbumBody,
  UpdateAlbumBody,
  SetAlbumItemsBody,
} from "@workspace/api-zod";
import {
  assertHasUpdates,
  badRequest,
  parseBody,
  parseId,
  requireRow,
} from "../lib/http";
import { currentUser } from "../middleware/require-auth";
import { isAudio } from "../lib/file-type";

/**
 * Albums: a named, ordered selection of photographs from the memory wall.
 *
 * An album never owns a photograph, it only points at one. Deleting an album
 * deletes the album — the pictures stay exactly where they were. That has to
 * stay true: somebody tidying up their albums at eleven at night must not be
 * able to lose the only copy of a photograph of their child, and no amount of
 * confirmation dialog is a substitute for the operation simply not doing it.
 */

const router: IRouter = Router();

const MAX_ITEMS = 500;

/**
 * The chosen song, as something the browser can play.
 *
 * Returned as a URL into the authenticated uploads handler rather than as
 * bytes: the audio is encrypted at rest like everything else, and it is only
 * ever decrypted for the account that owns it.
 */
async function musicOf(userId: number, uploadId: number | null) {
  if (uploadId === null) return { musicUrl: null, musicFilename: null };

  const [upload] = await db
    .select({ id: uploadsTable.id, filename: uploadsTable.filename })
    .from(uploadsTable)
    .where(and(eq(uploadsTable.userId, userId), eq(uploadsTable.id, uploadId)))
    .limit(1);

  // A file that has since been deleted leaves the album intact and silent.
  if (!upload) return { musicUrl: null, musicFilename: null };
  return {
    musicUrl: `/api/uploads/${upload.id}`,
    musicFilename: upload.filename,
  };
}

/** The album's photographs, in the order the person put them in. */
async function photosOf(userId: number, albumId: number) {
  return db
    .select({
      memoryId: memoriesTable.id,
      title: memoriesTable.title,
      description: memoriesTable.description,
      imageUrl: memoriesTable.imageUrl,
      dateTaken: memoriesTable.dateTaken,
    })
    .from(albumItemsTable)
    .innerJoin(memoriesTable, eq(memoriesTable.id, albumItemsTable.memoryId))
    .where(
      and(eq(albumItemsTable.userId, userId), eq(albumItemsTable.albumId, albumId)),
    )
    .orderBy(asc(albumItemsTable.position), asc(albumItemsTable.id));
}

async function detail(userId: number, albumId: number) {
  const [album] = await db
    .select()
    .from(albumsTable)
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.id, albumId)))
    .limit(1);

  const row = requireRow(album, "Album");
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ...(await musicOf(userId, row.musicUploadId)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photos: await photosOf(userId, albumId),
  };
}

router.get("/albums", async (req, res) => {
  const userId = currentUser(req).id;

  const albums = await db
    .select()
    .from(albumsTable)
    .where(eq(albumsTable.userId, userId))
    .orderBy(desc(albumsTable.updatedAt));

  // One extra query for every cover rather than a correlated subquery: the
  // list is a handful of rows, and the cover is simply the first photograph
  // in the order the person chose, which is the one they would expect.
  const withCovers = await Promise.all(
    albums.map(async (album) => {
      const photos = await photosOf(userId, album.id);
      return {
        id: album.id,
        title: album.title,
        description: album.description,
        photoCount: photos.length,
        coverImageUrl: photos.find((p) => p.imageUrl)?.imageUrl ?? null,
        ...(await musicOf(userId, album.musicUploadId)),
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
      };
    }),
  );

  res.json(withCovers);
});

router.post("/albums", async (req, res) => {
  const userId = currentUser(req).id;
  const values = parseBody(CreateAlbumBody, req.body);

  const [created] = await db
    .insert(albumsTable)
    .values({ ...values, userId })
    .returning();

  const row = requireRow(created, "Album");
  res.status(201).json({
    id: row.id,
    title: row.title,
    description: row.description,
    photoCount: 0,
    coverImageUrl: null,
    musicUrl: null,
    musicFilename: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

router.get("/albums/:id", async (req, res) => {
  const userId = currentUser(req).id;
  res.json(await detail(userId, parseId(req.params.id)));
});

router.put("/albums/:id", async (req, res) => {
  const userId = currentUser(req).id;
  const id = parseId(req.params.id);
  const values = assertHasUpdates(parseBody(UpdateAlbumBody.partial(), req.body));

  // Setting the song has to prove two things: that the file belongs to this
  // account, and that it is actually audio. Without the first, an album is a
  // way to play any file in the table by guessing its number.
  if (values.musicUploadId !== undefined && values.musicUploadId !== null) {
    const [upload] = await db
      .select({ mimeType: uploadsTable.mimeType })
      .from(uploadsTable)
      .where(
        and(
          eq(uploadsTable.userId, userId),
          eq(uploadsTable.id, values.musicUploadId),
        ),
      )
      .limit(1);

    if (!upload) throw badRequest("That file does not exist.");
    if (!isAudio(upload.mimeType)) {
      throw badRequest("That file is not audio.");
    }
  }

  const [updated] = await db
    .update(albumsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.id, id)))
    .returning();

  const row = requireRow(updated, "Album");
  const photos = await photosOf(userId, id);
  res.json({
    id: row.id,
    title: row.title,
    description: row.description,
    photoCount: photos.length,
    coverImageUrl: photos.find((p) => p.imageUrl)?.imageUrl ?? null,
    ...(await musicOf(userId, row.musicUploadId)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
});

router.delete("/albums/:id", async (req, res) => {
  const userId = currentUser(req).id;
  const id = parseId(req.params.id);

  // Only the album row. `album_items` goes with it by cascade; `memories` is
  // not referenced here at all, and must never be.
  const [deleted] = await db
    .delete(albumsTable)
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.id, id)))
    .returning({ id: albumsTable.id });

  requireRow(deleted, "Album");
  res.status(204).end();
});

/**
 * The contents and the order, replaced wholesale.
 *
 * Sent as one list rather than as add/remove/move calls so that what is on
 * the screen and what is in the database cannot drift apart halfway through
 * a reorder.
 */
router.put("/albums/:id/items", async (req, res) => {
  const userId = currentUser(req).id;
  const albumId = parseId(req.params.id);
  const { memoryIds } = parseBody(SetAlbumItemsBody, req.body);

  const [album] = await db
    .select({ id: albumsTable.id })
    .from(albumsTable)
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.id, albumId)))
    .limit(1);
  requireRow(album, "Album");

  if (memoryIds.length > MAX_ITEMS) {
    throw badRequest(`An album can hold up to ${MAX_ITEMS} photographs.`);
  }

  // The same picture twice would be a silent duplicate in a slideshow and a
  // repeated page in a printed book, so it is refused rather than deduped:
  // a list that came back shorter than it went in is its own confusion.
  const unique = new Set(memoryIds);
  if (unique.size !== memoryIds.length) {
    throw badRequest("The same photograph is in that list more than once.");
  }

  // Every id must be one of this account's own memories. Without this an
  // album is a way to read any row in the table by guessing its number.
  if (memoryIds.length > 0) {
    const owned = await db
      .select({ id: memoriesTable.id })
      .from(memoriesTable)
      .where(
        and(eq(memoriesTable.userId, userId), inArray(memoriesTable.id, memoryIds)),
      );
    if (owned.length !== unique.size) {
      throw badRequest("Some of those memories do not exist.");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(albumItemsTable)
      .where(
        and(
          eq(albumItemsTable.userId, userId),
          eq(albumItemsTable.albumId, albumId),
        ),
      );

    if (memoryIds.length > 0) {
      await tx.insert(albumItemsTable).values(
        memoryIds.map((memoryId, index) => ({
          userId,
          albumId,
          memoryId,
          position: index,
        })),
      );
    }

    await tx
      .update(albumsTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(albumsTable.userId, userId), eq(albumsTable.id, albumId)));
  });

  res.json(await detail(userId, albumId));
});

export default router;
