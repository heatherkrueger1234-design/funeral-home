import multer from "multer";
import type { RequestHandler, Response } from "express";
import { and, count, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  uploadsTable,
  casePhotosTable,
  familyContactsTable,
  funeralHomesTable,
  usersTable,
  MAX_PHOTOS_PER_CASE,
  type CasePhoto,
  type Upload,
} from "@workspace/db";
import { encryptBuffer, decryptBuffer } from "@workspace/db/crypto";
import { detectFileType } from "./file-type";
import { normaliseImage, renameForType } from "./images";
import { badRequest, HttpError, notFound } from "./http";
import { Gate } from "./concurrency";

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

/**
 * The limit on what may arrive, not on what is stored.
 *
 * A 48-megapixel phone photograph or a flatbed scan of a wedding portrait
 * can be well over 15 MB before it is downscaled, and refusing those at the
 * door would be refusing exactly the pictures families most want to send.
 * `normaliseImage` brings anything oversized down to a few hundred kilobytes
 * immediately afterwards.
 */
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;

/**
 * How many uploads this process holds at once.
 *
 * Each is buffered whole before anything can look at it, so the ceiling is
 * on memory: eight at 50 MB is 400 MB before conversion, inside the 2 GB
 * DEPLOY.md gives the API. A family's portal sends one photograph at a time,
 * so eight is eight families at the same moment. The ninth is told to wait a
 * few seconds and send it again, which both apps do without a word to
 * anyone, rather than being held open here.
 */
export const MAX_UPLOADS_AT_ONCE = 8;
export const uploadsGate = new Gate(MAX_UPLOADS_AT_ONCE);

/*
 * Before multer, so a turned-away upload is never read into memory at all;
 * the slot is given back when the response is done, however it ends.
 */
const waitYourTurn: RequestHandler = (_req, res, next) => {
  if (!uploadsGate.tryEnter()) {
    res.setHeader("retry-after", "3");
    next(
      new HttpError(
        429,
        "A lot of photographs are arriving at once. Yours will go in a moment.",
      ),
    );
    return;
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    uploadsGate.leave();
  };
  res.once("finish", release);
  res.once("close", release);
  next();
};

const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

/** One photograph in the named field, taken only when it is this one's turn. */
export const photoUpload = {
  single: (field: string): RequestHandler => {
    const read = parse.single(field);
    return (req, res, next) => {
      waitYourTurn(req, res, (error?: unknown) => {
        if (error) next(error);
        else void read(req, res, next);
      });
    };
  },
};

export type StoredUpload = Omit<Upload, "data">;

/**
 * Either the pool or an open transaction. Callers that write an upload and a
 * row referring to it must pass their transaction, or a failure on the second
 * write leaves the bytes behind with nothing pointing at them.
 */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** An upload checked and normalised, and not yet written anywhere. */
export type PreparedUpload = { filename: string; mimeType: string; data: Buffer };

/**
 * Everything about storing an upload that does not need the database:
 * checking what it is, and converting it.
 *
 * Kept apart because the conversion is the slow part — most of a second of
 * CPU for an ordinary 12-megapixel phone photograph, which is resized and
 * re-encoded — and it used to run inside the caller's transaction, holding a
 * pooled connection the whole time. Ten families uploading at once held all
 * ten, and every other family opening their page waited behind them for one
 * (the load test measured a bystander's page going from 14ms to 850ms).
 */
export async function prepareUpload(
  file: Express.Multer.File,
  imagesOnly = true,
): Promise<PreparedUpload> {
  if (!file?.buffer?.length) {
    throw badRequest("That file arrived empty. Please try again.");
  }

  const detected = detectFileType(file.buffer);

  if (!detected) {
    throw badRequest(
      "That file type isn't supported. Please upload a JPEG, PNG, WebP or GIF.",
    );
  }

  if (imagesOnly && detected.kind !== "image") {
    throw badRequest("Please upload a photograph.");
  }

  /*
   * Normalised before storage, not on the way out. An iPhone's HEIC is
   * transcoded to JPEG and anything enormous is downscaled once, here, rather
   * than on every request that serves it — and what lands in the database is
   * a format the browser, the slideshow pack and the printer all understand.
   */
  const normalised =
    detected.kind === "image"
      ? await normaliseImage(file.buffer, detected.mimeType)
      : { data: file.buffer, mimeType: detected.mimeType, converted: false };

  return {
    // The browser's filename is used for display only, and is stripped of
    // any path so a crafted name cannot look like a directory later.
    filename: renameForType(
      (file.originalname ?? "photo").split(/[\\/]/).pop()!.slice(0, 200),
      normalised.mimeType,
    ),
    mimeType: normalised.mimeType,
    data: normalised.data,
  };
}

/** Write a prepared upload, encrypted, in whatever transaction is open. */
export async function insertUpload(
  tx: Db,
  prepared: PreparedUpload,
  owner: {
    funeralHomeId: number;
    caseId: number | null;
    uploadedByUserId?: number | null;
    uploadedByContactId?: number | null;
  },
): Promise<StoredUpload> {
  const [row] = await tx
    .insert(uploadsTable)
    .values({
      funeralHomeId: owner.funeralHomeId,
      caseId: owner.caseId,
      uploadedByUserId: owner.uploadedByUserId ?? null,
      uploadedByContactId: owner.uploadedByContactId ?? null,
      filename: prepared.filename,
      mimeType: prepared.mimeType,
      sizeBytes: prepared.data.length,
      data: encryptBuffer(prepared.data),
    })
    .returning();

  const { data, ...summary } = row!;
  return summary;
}

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
  const prepared = await prepareUpload(options.file, options.imagesOnly !== false);
  return insertUpload(options.tx ?? db, prepared, options);
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
  options: {
    portraitPhotoId: number | null;
    referencePhotoId?: number | null;
    uploadedByName?: string | null;
  },
) {
  // The staff member's id stays on the server: a family is told the home
  // added it, not handed a user id they have no use for.
  const { uploadedByUserId, ...rest } = photo;
  return {
    ...rest,
    uploadedByName: options.uploadedByName ?? null,
    addedByHome: uploadedByUserId != null,
    isPortrait: options.portraitPhotoId === photo.id,
    isReference: (options.referencePhotoId ?? null) === photo.id,
  };
}

type CropFields = Pick<CasePhoto, "cropX" | "cropY" | "cropWidth" | "cropHeight">;

/** Anything smaller than this is a mis-tap, not a framing. */
const MIN_CROP_SIDE = 0.01;
/** Rounding slack: the portal sends four decimal places. */
const CROP_EPSILON = 1e-6;

/**
 * The crop a write leaves behind, checked as a whole.
 *
 * The contract bounds each of the four numbers to 0..1 on its own, and they
 * arrive one field at a time -- the portrait route and both photo PATCHes
 * merge whatever was sent over what was stored. Nothing checked the result:
 * `cropX: 0.9` over a stored width of 0.5 was saved as a rectangle running
 * half off the side of the photograph, and every screen that honoured it
 * then drew half a face and half nothing. So the merged rectangle is what is
 * checked, and it must be a real rectangle inside the picture.
 *
 * Returns only the fields to write -- none at all when the request did not
 * touch the crop -- so a caption edit never rewrites a framing.
 */
export function mergeCrop(
  existing: CropFields,
  values: Partial<Record<keyof CropFields, number | undefined>>,
): Partial<CropFields> {
  const touched =
    values.cropX !== undefined ||
    values.cropY !== undefined ||
    values.cropWidth !== undefined ||
    values.cropHeight !== undefined;
  if (!touched) return {};

  const merged = {
    cropX: values.cropX ?? existing.cropX,
    cropY: values.cropY ?? existing.cropY,
    cropWidth: values.cropWidth ?? existing.cropWidth,
    cropHeight: values.cropHeight ?? existing.cropHeight,
  };
  const { cropX, cropY, cropWidth, cropHeight } = merged;

  if (cropX === null || cropY === null || cropWidth === null || cropHeight === null) {
    throw badRequest(
      "A framing needs all four of cropX, cropY, cropWidth and cropHeight.",
    );
  }
  if (
    cropWidth < MIN_CROP_SIDE ||
    cropHeight < MIN_CROP_SIDE ||
    cropX + cropWidth > 1 + CROP_EPSILON ||
    cropY + cropHeight > 1 + CROP_EPSILON
  ) {
    throw badRequest("That framing runs off the edge of the photograph.");
  }

  return merged;
}

/**
 * Photographs on a case, in slideshow order, with their uploader's name.
 *
 * A photograph a staff member added is named for the home when a family is
 * looking ("Added by Horan & McConaty"), and for the person as well when the
 * home is: the family needs to know it did not come from a cousin, and the
 * office needs to know which of them scanned it.
 */
export async function photosForCase(
  caseId: number,
  funeralHomeId: number,
  portraitPhotoId: number | null,
  options: {
    includeHidden: boolean;
    referencePhotoId?: number | null;
    audience?: "staff" | "family";
  },
) {
  const rows = await db
    .select({
      photo: casePhotosTable,
      contactName: familyContactsTable.name,
      staffName: usersTable.displayName,
      homeName: funeralHomesTable.name,
    })
    .from(casePhotosTable)
    .leftJoin(
      familyContactsTable,
      eq(familyContactsTable.id, casePhotosTable.uploadedByContactId),
    )
    // Joined on the home as well as the id, so a staff row can only ever be
    // named after somebody who works there.
    .leftJoin(
      usersTable,
      and(
        eq(usersTable.id, casePhotosTable.uploadedByUserId),
        eq(usersTable.funeralHomeId, casePhotosTable.funeralHomeId),
      ),
    )
    .innerJoin(
      funeralHomesTable,
      eq(funeralHomesTable.id, casePhotosTable.funeralHomeId),
    )
    .where(
      and(
        eq(casePhotosTable.caseId, caseId),
        eq(casePhotosTable.funeralHomeId, funeralHomeId),
        options.includeHidden ? undefined : eq(casePhotosTable.status, "visible"),
      ),
    );

  /*
   * Selected photographs first, in slideshow order; then the rest of the bin
   * oldest first.
   *
   * The bin is deliberately chronological rather than ordered, because a pile
   * of four hundred photographs nobody has looked at yet has no meaningful
   * order except the one they arrived in -- and a family scrolling for the
   * one they uploaded a minute ago should find it where they left it.
   */
  return rows
    .sort((a, b) => {
      if (a.photo.selected !== b.photo.selected) return a.photo.selected ? -1 : 1;
      if (a.photo.selected) {
        return a.photo.position - b.photo.position || a.photo.id - b.photo.id;
      }
      return a.photo.id - b.photo.id;
    })
    .map(({ photo, contactName, staffName, homeName }) =>
      toPhotoJson(photo, {
        portraitPhotoId,
        referencePhotoId: options.referencePhotoId,
        uploadedByName:
          photo.uploadedByUserId != null
            ? staffUploaderName(options.audience ?? "staff", staffName, homeName)
            : contactName,
      }),
    );
}

function staffUploaderName(
  audience: "staff" | "family",
  staffName: string | null,
  homeName: string,
): string {
  if (audience === "family") return homeName;
  return staffName?.trim() ? `${staffName.trim()}, ${homeName}` : homeName;
}

/**
 * Put one photograph into a case's bin: the single path both doors use.
 *
 * The family's link and the director's Photos panel arrive here with the
 * same kind of file, so they get the same treatment -- the type sniffed from
 * the bytes, HEIC and AVIF transcoded, anything oversized or pixel-bombed
 * refused by `storeUpload`/`normaliseImage`, the bytes encrypted, and the
 * bin's ceiling checked on the server rather than trusted from either
 * client. Exactly one of `contactId` and `userId` says who added it.
 */
export async function addPhotoToCase(options: {
  funeralHomeId: number;
  caseId: number;
  file: Express.Multer.File | undefined;
  caption?: unknown;
  by: { contactId: number } | { userId: number };
}): Promise<CasePhoto> {
  const { funeralHomeId, caseId, file } = options;
  if (!file) throw badRequest("Please choose a photograph.");

  // Checked here rather than trusted from the client: the limit exists so a
  // broken client cannot fill the database, and whoever meets it should be
  // told plainly rather than silently having the next one dropped.
  const full = () =>
    badRequest(
      "contactId" in options.by
        ? `That's the ${MAX_PHOTOS_PER_CASE}-photograph limit. Remove one to add another, or ask the funeral home.`
        : `This case already holds ${MAX_PHOTOS_PER_CASE} photographs, which is the limit. Delete one to add another.`,
    );
  const countPhotos = async (tx: Db) => {
    const [existing] = await tx
      .select({ value: count() })
      .from(casePhotosTable)
      .where(
        and(
          eq(casePhotosTable.caseId, caseId),
          eq(casePhotosTable.funeralHomeId, funeralHomeId),
        ),
      );
    return Number(existing?.value ?? 0);
  };

  // Asked once before the expensive part, so a case that is already full
  // does not spend a second converting a photograph it will refuse.
  if ((await countPhotos(db)) >= MAX_PHOTOS_PER_CASE) throw full();

  const caption =
    typeof options.caption === "string" ? options.caption.trim() : "";
  const contactId = "contactId" in options.by ? options.by.contactId : null;
  const userId = "userId" in options.by ? options.by.userId : null;

  // The conversion, with no connection held (see `prepareUpload`).
  const prepared = await prepareUpload(file, true);

  return db.transaction(async (tx) => {
    /*
     * Then asked again, properly. The case row is locked first, so two
     * uploads arriving at the 999th photograph take turns and the second is
     * refused, instead of both counting 999 and both landing. It also keeps
     * `position` unique. NO KEY UPDATE rather than UPDATE, so it does not
     * hold up anything that only points at the case, such as a message.
     */
    await tx
      .select({ id: casesTable.id })
      .from(casesTable)
      .where(eq(casesTable.id, caseId))
      .for("no key update");
    const existing = await countPhotos(tx);
    if (existing >= MAX_PHOTOS_PER_CASE) throw full();

    // Same transaction as the photo row below: if that insert fails, the
    // bytes must go with it rather than linger unreferenced.
    const stored = await insertUpload(tx, prepared, {
      funeralHomeId,
      caseId,
      uploadedByContactId: contactId,
      uploadedByUserId: userId,
    });

    const [photo] = await tx
      .insert(casePhotosTable)
      .values({
        funeralHomeId,
        caseId,
        uploadId: stored.id,
        uploadedByContactId: contactId,
        uploadedByUserId: userId,
        caption: caption || null,
        position: existing,
      })
      .returning();

    return photo!;
  });
}

/**
 * Replace a case's slideshow selection, in the order given.
 *
 * Wholesale rather than per-photo toggling, because the question "which
 * fifty of these four hundred" is answered by looking at all of them at once,
 * and a per-photo endpoint would mean the client sending four hundred
 * requests to express one decision.
 *
 * Nothing is ever deleted here. A photograph left out of the slideshow stays
 * in the bin, keeps its caption, and can still be the portrait -- being cut
 * from a slideshow is not a reason for this software to throw away a
 * family's picture of their own mother.
 */
export async function setSelection(options: {
  caseId: number;
  funeralHomeId: number;
  photoIds: number[];
}): Promise<void> {
  const { caseId, funeralHomeId, photoIds } = options;

  const owned = await db
    .select({ id: casePhotosTable.id })
    .from(casePhotosTable)
    .where(
      and(
        eq(casePhotosTable.caseId, caseId),
        eq(casePhotosTable.funeralHomeId, funeralHomeId),
      ),
    );

  const known = new Set(owned.map((row) => row.id));
  const seen = new Set<number>();

  for (const id of photoIds) {
    if (!known.has(id)) throw badRequest("That photograph is not on this case.");
    if (seen.has(id)) throw badRequest("A photograph was listed twice.");
    seen.add(id);
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    // Clear first, so a photograph dropped from the selection cannot keep a
    // stale position and reappear in the middle of the running order.
    await tx
      .update(casePhotosTable)
      .set({ selected: false, position: 0, updatedAt: now })
      .where(
        and(
          eq(casePhotosTable.caseId, caseId),
          eq(casePhotosTable.funeralHomeId, funeralHomeId),
        ),
      );

    for (const [index, id] of photoIds.entries()) {
      await tx
        .update(casePhotosTable)
        .set({ selected: true, position: index, updatedAt: now })
        .where(eq(casePhotosTable.id, id));
    }
  });
}
