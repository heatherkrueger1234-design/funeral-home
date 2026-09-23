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

  it("takes the GPS position out of a photograph taken at home", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // Small enough to have been passed through untouched before, and
    // carrying what every phone writes: where it was taken.
    const tagged = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#5c7a3e" },
    })
      .withExif({
        IFD0: { Make: "Apple", Model: "iPhone 15" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "39/1 44/1 0/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "104/1 59/1 0/1",
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", tagged, "garden.jpg")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));
    const bytes = decryptBuffer(stored!.data);
    const meta = await sharp(bytes).metadata();

    expect(stored!.mimeType).toBe("image/jpeg");
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(800);
    expect(bytes.includes(Buffer.from("iPhone 15"))).toBe(false);

    // Cut out rather than re-encoded: every pixel is still the family's own.
    const [before, after] = await Promise.all([
      sharp(tagged).raw().toBuffer(),
      sharp(bytes).raw().toBuffer(),
    ]);
    expect(after.equals(before)).toBe(true);
  });

  it("turns a sideways phone photograph upright while it strips it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // Stored landscape, tagged "rotate 90° to view": a portrait taken on a phone.
    const sideways = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#3e5c7a" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBe(6);

    const uploaded = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", sideways, "portrait.jpg")
      .expect(201);

    const [stored] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, uploaded.body.uploadId));
    const meta = await sharp(decryptBuffer(stored!.data)).metadata();

    // Removing the tag without rotating would have laid it on its side.
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(800);
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
