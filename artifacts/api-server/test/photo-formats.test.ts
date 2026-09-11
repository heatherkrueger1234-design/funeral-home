import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, uploadsTable } from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import { eq } from "drizzle-orm";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, name));

/**
 * The formats that come off a real phone.
 *
 * These matter more than they look: an iPhone shoots HEIC by default, so
 * "which image formats do we accept" is really "does a family's photographs
 * of their mother work at all". A synthetic PNG would have passed every one
 * of these tests while the actual product rejected half of what it was sent.
 */
describe("photographs from a phone", () => {
  it("accepts a real HEIC and stores it as JPEG", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const heic = fixture("fixtures-real.heic");
    // Confirm the fixture really is HEIC and not a renamed JPEG.
    expect(heic.subarray(4, 8).toString("latin1")).toBe("ftyp");

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", heic, "IMG_4821.HEIC")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));

    // Stored as something every browser can actually display.
    expect(stored!.mimeType).toBe("image/jpeg");
    // And the filename no longer claims to be what it isn't.
    expect(stored!.filename).toMatch(/\.jpg$/i);

    // The bytes are a real, decodable JPEG of the original picture.
    const bytes = decryptBuffer(stored!.data);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeGreaterThan(0);
    expect(stored!.sizeBytes).toBe(bytes.length);
  });

  it("accepts AVIF, which newer phones emit", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", fixture("fixtures-phone.avif"), "photo.avif")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));

    expect(stored!.mimeType).toBe("image/jpeg");
  });

  it("downscales a photograph nobody can load over hotel wifi", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const huge = fixture("fixtures-huge.jpg");
    const before = await sharp(huge).metadata();
    expect(before.width).toBe(6000);

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", huge, "scan.jpg")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));

    const after = await sharp(decryptBuffer(stored!.data)).metadata();

    // Long edge brought down, aspect ratio kept.
    expect(after.width).toBe(3000);
    expect(after.height).toBe(2000);
    expect(stored!.sizeBytes).toBeLessThan(huge.length);
  });

  it("leaves an ordinary photograph exactly as it arrived", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const modest = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#7a5c3e" },
    })
      .jpeg()
      .toBuffer();

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", modest, "gran.jpg")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));

    // No needless re-encode: the family's own file, byte for byte.
    expect(decryptBuffer(stored!.data).equals(modest)).toBe(true);
  });

  it("still refuses something that is not an image at all", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", Buffer.from("<html>not a photo</html>"), "nice.jpg")
      .expect(400);
  });
});
