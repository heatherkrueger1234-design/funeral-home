import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { and, eq } from "drizzle-orm";
import {
  db,
  casePhotosTable,
  uploadsTable,
  MAX_PHOTOS_PER_CASE,
} from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import {
  PNG_BYTES,
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
} from "./helpers";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, name));

/**
 * A PNG whose header claims far more pixels than any photograph has, with a
 * few bytes of compressed zeros behind it: small on the wire, gigabytes once
 * decoded. The kind of file the pixel limit exists for.
 */
function pngBomb(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(64 * 1024))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A print posted to the office has to reach the case.
 *
 * `/uploads` stored staff files with no case, so a photograph the director
 * scanned never appeared in the bin, the pack or the slideshow. Staff now add
 * photographs to a case directly, through the family's own pipeline.
 */
describe("staff adding a photograph to a case", () => {
  it("puts it in the case's bin, marked as the home's, for both audiences", async () => {
    const staff = await signUpHome("Horan & McConaty");
    const kase = await createCase(staff);
    const { token } = await inviteFamily(staff, kase.id);

    const added = await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .field("caption", "Wedding day, 1962")
      .attach("file", PNG_BYTES, "scan.png")
      .expect(201);

    expect(added.body.caseId).toBe(kase.id);
    expect(added.body.caption).toBe("Wedding day, 1962");
    expect(added.body.addedByHome).toBe(true);
    expect(added.body.uploadedByContactId).toBeNull();
    // Never handed out: the family has no use for a staff user id.
    expect(added.body).not.toHaveProperty("uploadedByUserId");

    // Staff see who in the office added it.
    const bin = await staff.agent.get(`/api/cases/${kase.id}/photos`).expect(200);
    expect(bin.body).toHaveLength(1);
    expect(bin.body[0].uploadedByName).toBe("Karen Voss, Horan & McConaty");

    // The family sees it came from the home.
    const theirs = await asFamily(token).get("/api/family/photos").expect(200);
    expect(theirs.body).toHaveLength(1);
    expect(theirs.body[0].addedByHome).toBe(true);
    expect(theirs.body[0].uploadedByName).toBe("Horan & McConaty");

    // Recorded against the staff member, and stored with the case.
    const [row] = await db
      .select()
      .from(casePhotosTable)
      .where(eq(casePhotosTable.id, added.body.id));
    expect(row!.uploadedByUserId).toBe(staff.userId);
    const [upload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, added.body.uploadId));
    expect(upload!.caseId).toBe(kase.id);
    expect(upload!.uploadedByUserId).toBe(staff.userId);
    // Encrypted at rest, like everything else.
    expect(upload!.data.equals(PNG_BYTES)).toBe(false);
    expect(decryptBuffer(upload!.data).equals(PNG_BYTES)).toBe(true);

    // It runs in the slideshow and the pack says where it came from.
    await staff.agent
      .put(`/api/cases/${kase.id}/photos/selection`)
      .send({ photoIds: [added.body.id] })
      .expect(200);
    const pack = await staff.agent
      .get(`/api/cases/${kase.id}/photo-pack`)
      .buffer(true)
      .parse((res, done) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => done(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect((pack.body as Buffer).toString("utf8")).toContain(
      "Wedding day, 1962 — from Horan & McConaty",
    );
  });

  it("cannot be removed by a family member, only by the home", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);
    const { token } = await inviteFamily(staff, kase.id);

    const added = await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .attach("file", PNG_BYTES, "scan.png")
      .expect(201);

    await asFamily(token)
      .delete(`/api/family/photos/${added.body.id}`)
      .expect(403);
    await staff.agent.delete(`/api/photos/${added.body.id}`).expect(204);
  });

  it("uses the family's pipeline: HEIC becomes JPEG, non-images are refused", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);

    const heic = await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .attach("file", fixture("fixtures-real.heic"), "IMG_0001.HEIC")
      .expect(201);
    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, heic.body.uploadId));
    expect(stored!.mimeType).toBe("image/jpeg");

    await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .attach("file", Buffer.from("<html><script>alert(1)</script>"), "x.png")
      .expect(400);

    await staff.agent.post(`/api/cases/${kase.id}/photos`).expect(400);
  });

  it("does not store a decompression bomb as a photograph", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);

    const refused = await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .attach("file", pngBomb(40_000, 40_000), "bomb.png")
      .expect(400);
    expect(refused.body.error).toMatch(/could not be read/);

    const rows = await db
      .select()
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, kase.id));
    expect(rows).toHaveLength(0);
  });

  it("cannot add to another home's case, and stores nothing when it tries", async () => {
    const mine = await signUpHome("Alpha");
    const theirs = await signUpHome("Bravo");
    const theirCase = await createCase(theirs);

    await mine.agent
      .post(`/api/cases/${theirCase.id}/photos`)
      .attach("file", PNG_BYTES, "intruder.png")
      .expect(404);

    const photos = await db
      .select()
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, theirCase.id));
    expect(photos).toHaveLength(0);

    const uploads = await db
      .select()
      .from(uploadsTable)
      .where(
        and(
          eq(uploadsTable.funeralHomeId, mine.homeId),
          eq(uploadsTable.uploadedByUserId, mine.userId),
        ),
      );
    expect(uploads).toHaveLength(0);
  });

  it("respects the bin's ceiling", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);
    const { encryptBuffer } = await import("@workspace/db/crypto");

    const [upload] = await db
      .insert(uploadsTable)
      .values({
        funeralHomeId: staff.homeId,
        caseId: kase.id,
        filename: "seed.png",
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.length,
        data: encryptBuffer(PNG_BYTES),
      })
      .returning();
    await db.insert(casePhotosTable).values(
      Array.from({ length: MAX_PHOTOS_PER_CASE }, (_, i) => ({
        funeralHomeId: staff.homeId,
        caseId: kase.id,
        uploadId: upload!.id,
        position: i,
      })),
    );

    const refused = await staff.agent
      .post(`/api/cases/${kase.id}/photos`)
      .attach("file", PNG_BYTES, "one-too-many.png")
      .expect(400);
    expect(refused.body.error).toContain(String(MAX_PHOTOS_PER_CASE));
  });
});
