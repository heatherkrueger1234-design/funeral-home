import path from "node:path";
import { Router, type IRouter } from "express";
import multer from "multer";
import { and, eq, sql } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { DecryptionError, decryptBuffer, encryptBuffer } from "@workspace/db/crypto";
import { HttpError, badRequest, parseId, requireRow } from "../lib/http";
import { currentUser } from "../middleware/require-auth";
import {
  ACCEPTED_DESCRIPTION,
  detectFileType,
} from "../lib/file-type";

const router: IRouter = Router();

/** Generous for a photograph, small enough that a bad request cannot exhaust memory. */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Audio gets more room, because a song is bigger than a photograph and the
 * one somebody wants is usually the one off their own hard drive rather than
 * a compressed copy. Forty megabytes covers a long track at a high bitrate,
 * and lossless files that go over it are the case where asking for an MP3 is
 * a reasonable thing to say.
 */
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

/** What multer is allowed to buffer, before we know what the file is. */
export const MAX_UPLOAD_BYTES = MAX_AUDIO_BYTES;

/**
 * A ceiling on what one account may store.
 *
 * Files live in the database, which is a shared, paid resource. Without a cap
 * a single account — careless or malicious — can fill it and take the site
 * down for every other family using it. Two gigabytes is roughly a thousand
 * phone photographs, which is far more than this is for, and it is
 * configurable for the day that turns out to be wrong.
 */
const DEFAULT_ACCOUNT_BYTES = 2 * 1024 * 1024 * 1024;

export function maxAccountBytes(): number {
  const raw = process.env.MAX_ACCOUNT_STORAGE_BYTES;
  if (raw === undefined) return DEFAULT_ACCOUNT_BYTES;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `MAX_ACCOUNT_STORAGE_BYTES must be a positive integer, got "${raw}"`,
    );
  }
  return value;
}

/** Bytes this account is already using. */
async function bytesUsed(userId: number): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${uploadsTable.sizeBytes}), 0)`,
    })
    .from(uploadsTable)
    .where(eq(uploadsTable.userId, userId));

  // sum() comes back as a string from pg for bigint-ish results.
  return Number(row?.total ?? 0);
}

// Memory storage, not disk: the bytes go straight into Postgres, and the
// deployment target's filesystem does not survive a redeploy anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function sanitiseFilename(original: string, extension: string): string {
  // The name is echoed back in Content-Disposition, so strip anything that
  // could traverse a path or break out of the header.
  const base = path
    .basename(original || "upload")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const withoutExtension = base.replace(/\.[^.]*$/, "") || "upload";
  return `${withoutExtension}.${extension}`;
}

router.post("/uploads", upload.single("file"), async (req, res) => {
  const user = currentUser(req);
  const file = req.file;

  if (!file) {
    throw badRequest('No file was sent. Attach it as the "file" field.');
  }

  // The browser's declared type is discarded in favour of what the bytes
  // actually are — see lib/file-type.ts.
  const detected = detectFileType(file.buffer);

  if (!detected) {
    throw badRequest(
      `That file type isn't supported. Please use ${ACCEPTED_DESCRIPTION}.`,
    );
  }

  // Multer buffers up to the audio ceiling because the type is not known
  // until the bytes have arrived. Now that it is known, the tighter limit
  // applies to everything that is not audio.
  const typeLimit = detected.kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > typeLimit) {
    throw new HttpError(
      413,
      `That file is ${formatBytes(file.size)}, and the limit for ${
        detected.kind === "audio" ? "audio" : "images and documents"
      } is ${formatBytes(typeLimit)}.`,
    );
  }

  // Checked here rather than in middleware because the real size is only
  // known once the body has arrived.
  const limit = maxAccountBytes();
  const used = await bytesUsed(user.id);

  if (used + file.size > limit) {
    const remaining = Math.max(0, limit - used);
    throw new HttpError(
      413,
      remaining === 0
        ? "There's no space left in your account. You can remove some files, or download everything first if you'd rather keep it all."
        : `That file is larger than the space left in your account (${formatBytes(remaining)} remaining).`,
    );
  }

  const [created] = await db
    .insert(uploadsTable)
    .values({
      userId: user.id,
      filename: sanitiseFilename(file.originalname, detected.extension),
      mimeType: detected.mimeType,
      sizeBytes: file.size,
      data: encryptBuffer(file.buffer),
    })
    .returning({
      id: uploadsTable.id,
      filename: uploadsTable.filename,
      mimeType: uploadsTable.mimeType,
      sizeBytes: uploadsTable.sizeBytes,
      createdAt: uploadsTable.createdAt,
    });

  res.status(201).json({ ...created, url: `/api/uploads/${created.id}` });
});

/**
 * Files are served through this handler rather than a static directory, so
 * that every read is authenticated and scoped. A photograph of someone's dead
 * child must not sit behind a guessable public URL.
 */
router.get("/uploads/usage", async (req, res) => {
  const user = currentUser(req);
  const limitBytes = maxAccountBytes();
  const usedBytes = await bytesUsed(user.id);

  res.json({ usedBytes, limitBytes });
});

router.get("/uploads/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [row] = await db
    .select()
    .from(uploadsTable)
    .where(and(eq(uploadsTable.id, id), eq(uploadsTable.userId, user.id)))
    .limit(1);

  const upload = requireRow(row, `File ${id} not found`);

  let bytes: Buffer;

  try {
    bytes = decryptBuffer(upload.data);
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error;
    throw new HttpError(
      422,
      "This file could not be opened. It may have been stored with a different encryption key.",
    );
  }

  res.setHeader("content-type", upload.mimeType);
  res.setHeader("content-length", String(bytes.length));
  // `inline` so photographs render in place; the filename is still offered if
  // the viewer chooses to save. Private caching only — never a shared proxy.
  res.setHeader(
    "content-disposition",
    `inline; filename="${upload.filename}"`,
  );
  res.setHeader("cache-control", "private, max-age=3600");
  // Belt and braces alongside the sniffed type: never let a browser guess.
  res.setHeader("x-content-type-options", "nosniff");
  res.send(bytes);
});

router.delete("/uploads/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const [deleted] = await db
    .delete(uploadsTable)
    .where(and(eq(uploadsTable.id, id), eq(uploadsTable.userId, user.id)))
    .returning({ id: uploadsTable.id });

  requireRow(deleted, `File ${id} not found`);
  res.status(204).end();
});

export default router;
