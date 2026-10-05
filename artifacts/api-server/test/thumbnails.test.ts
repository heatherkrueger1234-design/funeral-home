import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { Test } from "supertest";
import { eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import {
  MAX_THUMBNAILS_AT_ONCE,
  THUMBNAILS_IN_LINE,
  THUMBNAIL_EDGE,
  thumbnailsGate,
} from "../src/lib/media";
import {
  asFamily,
  createCase,
  inviteFamily,
  PNG_BYTES,
  signUpHome,
  type StaffSession,
} from "./helpers";

/**
 * Thumbnails (`?size=thumb`).
 *
 * The family's photographs page draws every picture in a 96-pixel square,
 * and fetched each one whole to do it: a bin of several hundred was enough
 * to bring down an older iPhone's browser, and every row cost the family
 * half a megabyte of mobile data. A thumbnail is made once, kept like any
 * upload, and must be exactly as private as the photograph it was made from.
 */

/** A photograph about the size of one off a phone once the upload has normalised it. */
function aPhotograph(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
      noise: { type: "gaussian", mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function addPhoto(
  staff: StaffSession,
  caseId: number,
  bytes: Buffer,
): Promise<{ photoId: number; uploadId: number }> {
  const res = await staff.agent
    .post(`/api/cases/${caseId}/photos`)
    .attach("file", bytes, { filename: "mum.jpg", contentType: "image/jpeg" })
    .expect(201);
  return { photoId: res.body.id, uploadId: res.body.uploadId };
}

/** The response's bytes, whatever type it says it is. */
function bytes(request: Test): Test {
  return request.buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
  });
}

async function uploadRow(id: number) {
  const [row] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, id));
  return row;
}

async function uploadCount(): Promise<number> {
  return (await db.select({ id: uploadsTable.id }).from(uploadsTable)).length;
}

describe("a thumbnail of a photograph", () => {
  it("is a small JPEG, made once from the stored photograph and kept like it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const original = await aPhotograph();
    const { uploadId } = await addPhoto(staff, row.id, original);

    const res = await bytes(staff.agent.get(`/api/uploads/${uploadId}?size=thumb`)).expect(200);
    const thumb = res.body as Buffer;

    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(thumb.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(THUMBNAIL_EDGE);
    expect(meta.width! / meta.height!).toBeCloseTo(1600 / 1200, 1);
    expect(thumb.length).toBeLessThan(original.length / 10);

    // Kept as an upload of its own: encrypted, on the same home and case.
    const photo = await uploadRow(uploadId);
    expect(photo!.thumbnailUploadId).not.toBeNull();
    expect(photo!.thumbnailUploadId).not.toBe(uploadId);
    const kept = await uploadRow(photo!.thumbnailUploadId!);
    expect(kept).toMatchObject({
      funeralHomeId: staff.homeId,
      caseId: row.id,
      mimeType: "image/jpeg",
      sizeBytes: thumb.length,
    });
    expect(decryptBuffer(kept!.data)).toEqual(thumb);
    expect(kept!.data.includes(thumb.subarray(0, 64))).toBe(false);

    // Asked for again, it is the same one, and nothing new is made.
    const count = await uploadCount();
    const again = await bytes(staff.agent.get(`/api/uploads/${uploadId}?size=thumb`)).expect(200);
    expect(again.body).toEqual(thumb);
    expect(await uploadCount()).toBe(count);

    // The photograph itself is untouched, and still what an unadorned URL gives.
    const full = await bytes(staff.agent.get(`/api/uploads/${uploadId}`)).expect(200);
    expect(full.body).toEqual(original);
    const named = await bytes(staff.agent.get(`/api/uploads/${uploadId}?size=full`)).expect(200);
    expect(named.body).toEqual(original);
  });

  it("is made once however many ask for it at the same moment", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { uploadId } = await addPhoto(staff, row.id, await aPhotograph());
    const count = await uploadCount();

    const answers = await Promise.all(
      Array.from({ length: 4 }, () =>
        bytes(staff.agent.get(`/api/uploads/${uploadId}?size=thumb`)).expect(200),
      ),
    );

    for (const answer of answers) expect(answer.body).toEqual(answers[0]!.body);
    expect(await uploadCount()).toBe(count + 1);
    const kept = await uploadRow((await uploadRow(uploadId))!.thumbnailUploadId!);
    expect(decryptBuffer(kept!.data)).toEqual(answers[0]!.body);
  });

  it("is what the family is given through their own link, the same one", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await inviteFamily(staff, row.id);
    const { uploadId } = await addPhoto(staff, row.id, await aPhotograph());

    const theirs = await bytes(
      asFamily(anne.token).get(`/api/family/uploads/${uploadId}?size=thumb`),
    ).expect(200);
    expect(theirs.headers["content-type"]).toBe("image/jpeg");
    const meta = await sharp(theirs.body as Buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(THUMBNAIL_EDGE);
    const count = await uploadCount();

    const ours = await bytes(staff.agent.get(`/api/uploads/${uploadId}?size=thumb`)).expect(200);
    expect(ours.body).toEqual(theirs.body);
    expect(await uploadCount()).toBe(count);
  });

  it("is refused to anybody the photograph is refused to, and made for none of them", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { uploadId } = await addPhoto(staff, row.id, await aPhotograph());

    const otherCase = await createCase(staff, { decedentLastName: "Other" });
    const otherFamily = await inviteFamily(staff, otherCase.id);
    const otherHome = await signUpHome("Another Home");

    // Asked for first by the wrong people: refused, and nothing is made.
    await asFamily(otherFamily.token)
      .get(`/api/family/uploads/${uploadId}?size=thumb`)
      .expect(404);
    await otherHome.agent.get(`/api/uploads/${uploadId}?size=thumb`).expect(404);
    expect((await uploadRow(uploadId))!.thumbnailUploadId).toBeNull();

    // Once it exists, the thumbnail's own id is no way round that either.
    await staff.agent.get(`/api/uploads/${uploadId}?size=thumb`).expect(200);
    const thumbId = (await uploadRow(uploadId))!.thumbnailUploadId!;
    for (const path of [`${uploadId}?size=thumb`, `${thumbId}`, `${thumbId}?size=thumb`]) {
      await asFamily(otherFamily.token).get(`/api/family/uploads/${path}`).expect(404);
      await otherHome.agent.get(`/api/uploads/${path}`).expect(404);
    }

    // A word the route does not know is refused rather than guessed at.
    await staff.agent.get(`/api/uploads/${uploadId}?size=huge`).expect(400);
  });

  it("goes with the photograph when the photograph is deleted, by either side", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await inviteFamily(staff, row.id);

    const fromHome = await addPhoto(staff, row.id, await aPhotograph());
    const fromAnne = await asFamily(anne.token)
      .post("/api/family/photos")
      .attach("file", await aPhotograph(), { filename: "anne.jpg", contentType: "image/jpeg" })
      .expect(201);

    for (const uploadId of [fromHome.uploadId, fromAnne.body.uploadId as number]) {
      await staff.agent.get(`/api/uploads/${uploadId}?size=thumb`).expect(200);
    }
    const thumbs = await Promise.all(
      [fromHome.uploadId, fromAnne.body.uploadId as number].map(
        async (uploadId) => (await uploadRow(uploadId))!.thumbnailUploadId!,
      ),
    );
    for (const thumbId of thumbs) {
      expect((await uploadRow(thumbId))?.mimeType).toBe("image/jpeg");
    }

    await staff.agent.delete(`/api/photos/${fromHome.photoId}`).expect(204);
    await asFamily(anne.token).delete(`/api/family/photos/${fromAnne.body.id}`).expect(204);

    for (const id of [fromHome.uploadId, fromAnne.body.uploadId as number, ...thumbs]) {
      expect(await uploadRow(id)).toBeUndefined();
    }
  });

  it("is the photograph itself when that is already as small as a thumbnail", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await inviteFamily(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, { filename: "tiny.png", contentType: "image/png" })
      .expect(201);
    const uploadId = res.body.uploadId as number;
    const count = await uploadCount();

    const thumb = await bytes(
      asFamily(anne.token).get(`/api/family/uploads/${uploadId}?size=thumb`),
    ).expect(200);

    expect(thumb.headers["content-type"]).toBe("image/png");
    expect(thumb.body).toEqual(PNG_BYTES);
    expect((await uploadRow(uploadId))!.thumbnailUploadId).toBe(uploadId);
    expect(await uploadCount()).toBe(count);
  });

  it("turns a crowd away with a time to come back, and never one it need not make", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const made = await addPhoto(staff, row.id, await aPhotograph());
    await staff.agent.get(`/api/uploads/${made.uploadId}?size=thumb`).expect(200);
    const fresh = await addPhoto(staff, row.id, await aPhotograph());

    // Every slot taken, and the line behind them full.
    for (let slot = 0; slot < MAX_THUMBNAILS_AT_ONCE; slot += 1) {
      expect(thumbnailsGate.tryEnter()).toBe(true);
    }
    const inLine = Array.from({ length: THUMBNAILS_IN_LINE }, () => thumbnailsGate.enter());

    try {
      const busy = await staff.agent.get(`/api/uploads/${fresh.uploadId}?size=thumb`).expect(429);
      expect(Number(busy.headers["retry-after"])).toBeGreaterThan(0);
      expect((await uploadRow(fresh.uploadId))!.thumbnailUploadId).toBeNull();

      // One already made is served without waiting for a turn, and so is
      // the photograph itself: there is nothing to make for either.
      await staff.agent.get(`/api/uploads/${made.uploadId}?size=thumb`).expect(200);
      await staff.agent.get(`/api/uploads/${fresh.uploadId}`).expect(200);
    } finally {
      for (let turn = 0; turn < MAX_THUMBNAILS_AT_ONCE + THUMBNAILS_IN_LINE; turn += 1) {
        thumbnailsGate.leave();
      }
      await Promise.all(inLine);
    }

    expect(thumbnailsGate.inUse).toBe(0);
    await staff.agent.get(`/api/uploads/${fresh.uploadId}?size=thumb`).expect(200);
  });
});
