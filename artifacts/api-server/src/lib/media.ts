import multer from "multer";
import type { Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  uploadsTable,
  casePhotosTable,
  familyContactsTable,
  type CasePhoto,
  type Upload,
} from "@workspace/db";
import { encryptBuffer, decryptBuffer } from "@workspace/db/crypto";
import { detectFileType } from "./file-type";
import { badRequest, HttpError, notFound } from "./http";

/**
 * Storing and serving bytes.
 *
 * Two rules, both about not trusting the client:
 *
 *  - The type is read from the file's own leading bytes, never from the
 *    `Content-Type` the browser attached. That header is a string the client
 *    chose; believing it would let someone store an HTML document as
 *    `image/png` and have it rendered as a document on this origin.
 *  - The bytes are encrypted at rest with the same key as everything else.
 *    These are photographs of a family's dead relative, sitting in a database
 *    that a third-party host backs up.
 */

/** Generous enough for a phone photograph, small enough to bound the table. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

export type StoredUpload = Omit<Upload, "data">;

/**
 * Either the pool or an open transaction. Callers that write an upload and a
 * row referring to it must pass their transaction, or a failure on the second
 * write leaves the bytes behind with nothing pointing at them.
 */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function storeUpload(options: {
  funeralHomeId: number;
  caseId: number | null;
  uploadedByUserId?: number | null;
  uploadedByContactId?: number | null;
  file: Express.Multer.File;
  imagesOnly?: boolean;
  /** Defaults to the pool, for the single-write case. */
  tx?: Db;
}): Promise<StoredUpload> {
  const { file } = options;

  if (!file?.buffer?.length) {
    throw badRequest("That file arrived empty. Please try again.");
  }

  const detected = detectFileType(file.buffer);

  if (!detected) {
    throw badRequest(
      "That file type isn't supported. Please upload a JPEG, PNG, WebP or GIF.",
    );
  }

  if (options.imagesOnly !== false && detected.kind !== "image") {
    throw badRequest("Please upload a photograph.");
  }

  const [row] = await (options.tx ?? db)
    .insert(uploadsTable)
    .values({
      funeralHomeId: options.funeralHomeId,
      caseId: options.caseId,
      uploadedByUserId: options.uploadedByUserId ?? null,
      uploadedByContactId: options.uploadedByContactId ?? null,
      // The browser's filename is used for display only, and is stripped of
      // any path so a crafted name cannot look like a directory later.
      filename: (file.originalname ?? "photo").split(/[\\/]/).pop()!.slice(0, 200),
      mimeType: detected.mimeType,
      sizeBytes: file.buffer.length,
      data: encryptBuffer(file.buffer),
    })
    .returning();

  const { data, ...summary } = row!;
  return summary;
}

/**
 * Serve stored bytes.
 *
 * `funeralHomeId` is always required and `caseId` is required for anything a
 * family can reach — so a link holder can fetch photographs from their own
 * case and the home's logo, and nothing else, however they mangle the id.
 */
export async function serveUpload(
  res: Response,
  options: {
    uploadId: number;
    funeralHomeId: number;
    /**
     * Set for family requests. When present, the only files that may be
     * served are the ones on that case, plus `logoUploadId` below.
     */
    caseId?: number;
    /** The home's logo, which families legitimately need for branding. */
    logoUploadId?: number | null;
  },
): Promise<void> {
  const [row] = await db
    .select()
    .from(uploadsTable)
    .where(
      and(
        eq(uploadsTable.id, options.uploadId),
        eq(uploadsTable.funeralHomeId, options.funeralHomeId),
      ),
    )
    .limit(1);

  if (!row) throw notFound("That file could not be found.");

  /*
   * A family request is scoped to one case, and to the logo.
   *
   * This used to allow anything with a null case id, on the reasoning that
   * the logo has no case. That was wrong: every staff upload is stored with
   * a null case id too, so one family's link could fetch any file the home
   * had ever uploaded -- including one meant for another family. Now the
   * exception is the specific logo id and nothing else.
   */
  if (options.caseId !== undefined) {
    const isOwnCaseFile = row.caseId === options.caseId;
    const isTheLogo =
      options.logoUploadId != null && row.id === options.logoUploadId;

    if (!isOwnCaseFile && !isTheLogo) {
      throw notFound("That file could not be found.");
    }
  }

  let bytes: Buffer;
  try {
    bytes = decryptBuffer(row.data);
  } catch {
    throw new HttpError(500, "That file could not be read.");
  }

  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Length", String(bytes.length));
  // The type was determined by sniffing, but a browser that decides to
  // second-guess it is exactly the hole sniffing was meant to close.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  // Immutable: rows are never rewritten, only added and deleted.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.end(bytes);
}

/**
 * A photograph as the API describes it.
 *
 * `isPortrait` is derived from the case rather than stored on the photo, so
 * that "which one is the portrait" has exactly one answer and cannot drift
 * out of step with `cases.portraitPhotoId`.
 */
export function toPhotoJson(
  photo: CasePhoto,
  options: { portraitPhotoId: number | null; uploadedByName?: string | null },
) {
  return {
    ...photo,
    uploadedByName: options.uploadedByName ?? null,
    isPortrait: options.portraitPhotoId === photo.id,
  };
}

/** Photographs on a case, in slideshow order, with their uploader's name. */
export async function photosForCase(
  caseId: number,
  funeralHomeId: number,
  portraitPhotoId: number | null,
  options: { includeHidden: boolean },
) {
  const rows = await db
    .select({ photo: casePhotosTable, uploadedByName: familyContactsTable.name })
    .from(casePhotosTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, casePhotosTable.uploadedByContactId),
    )
    .where(
      and(
        eq(casePhotosTable.caseId, caseId),
        eq(casePhotosTable.funeralHomeId, funeralHomeId),
        options.includeHidden ? undefined : eq(casePhotosTable.status, "visible"),
      ),
    );

  return rows
    .sort((a, b) => a.photo.position - b.photo.position || a.photo.id - b.photo.id)
    .map(({ photo, uploadedByName }) =>
      toPhotoJson(photo, { portraitPhotoId, uploadedByName }),
    );
}
