import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, casePhotosTable, casesTable, uploadsTable } from "@workspace/db";
import { decryptBuffer } from "@workspace/db/crypto";
import {
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
  type StaffSession,
} from "./helpers";

/**
 * The portrait crop, stored as instructions.
 *
 * replit.md promises "a portrait crop stored as instructions so the original
 * bytes survive". These pin the three halves of that promise: the
 * instructions are a real rectangle inside the photograph, the original is
 * never rewritten, and every place the portrait is printed honours the same
 * rectangle the family chose in the portal.
 */

/**
 * 400x200: left half red, right half blue. A crop of the right side must
 * come out blue, which is how the tests below see what was cut.
 */
async function twoToneJpeg(options: { orientation?: number } = {}) {
  const left = await sharp({
    create: { width: 200, height: 200, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  let image = sharp({
    create: { width: 400, height: 200, channels: 3, background: "#0000ff" },
  })
    .composite([{ input: left, left: 0, top: 0 }])
    .jpeg({ quality: 95 });
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return image.toBuffer();
}

async function withPortraitPhoto(staff: StaffSession, bytes: Buffer) {
  const row = await createCase(staff);
  const { token } = await inviteFamily(staff, row.id);
  const family = asFamily(token);
  const photo = await family
    .post("/api/family/photos")
    .attach("file", bytes, "mum.jpg")
    .expect(201);
  return { row, family, photoId: photo.body.id as number };
}

/** The first embedded picture in a rendered page, decoded. */
async function embedded(html: string, marker: string) {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const match = /data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/.exec(html.slice(at));
  expect(match).not.toBeNull();
  const bytes = Buffer.from(match![1]!, "base64");
  const meta = await sharp(bytes).metadata();
  const { dominant } = await sharp(bytes).stats();
  return { width: meta.width!, height: meta.height!, dominant };
}

// The right-hand 4:5 of a 400x200 picture: 160 tall, 128 wide.
const RIGHT_SIDE = { cropX: 0.66, cropY: 0.1, cropWidth: 0.32, cropHeight: 0.8 };

describe("the instructions", () => {
  it("stores a whole crop with the portrait, and leaves the bytes alone", async () => {
    const staff = await signUpHome();
    const bytes = await twoToneJpeg();
    const { row, family, photoId } = await withPortraitPhoto(staff, bytes);

    const [before] = await db
      .select({ uploadId: casePhotosTable.uploadId })
      .from(casePhotosTable)
      .where(eq(casePhotosTable.id, photoId));
    const [upload] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, before!.uploadId));
    const original = decryptBuffer(upload!.data);

    const res = await family
      .put("/api/family/portrait")
      .send({ photoId, ...RIGHT_SIDE })
      .expect(200);

    expect(res.body).toMatchObject({ isPortrait: true, ...RIGHT_SIDE });

    const [after] = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.id, before!.uploadId));
    expect(decryptBuffer(after!.data).equals(original)).toBe(true);

    const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, row.id));
    expect(caseRow!.portraitPhotoId).toBe(photoId);
  });

  it("refuses a rectangle that runs off the photograph, and does not move the portrait", async () => {
    const staff = await signUpHome();
    const { row, family, photoId } = await withPortraitPhoto(staff, await twoToneJpeg());

    await family
      .put("/api/family/portrait")
      .send({ photoId, cropX: 0.9, cropY: 0, cropWidth: 0.5, cropHeight: 0.5 })
      .expect(400);

    const [caseRow] = await db.select().from(casesTable).where(eq(casesTable.id, row.id));
    expect(caseRow!.portraitPhotoId).toBeNull();
  });

  it("checks the merged rectangle when only some of it is sent", async () => {
    const staff = await signUpHome();
    const { family, photoId } = await withPortraitPhoto(staff, await twoToneJpeg());

    // Half a crop on a photograph with none: not a rectangle at all.
    await family.put("/api/family/portrait").send({ photoId, cropX: 0.1 }).expect(400);

    await family.put("/api/family/portrait").send({ photoId, ...RIGHT_SIDE }).expect(200);
    // Moving x alone past what the stored width allows.
    await family.put("/api/family/portrait").send({ photoId, cropX: 0.8 }).expect(400);
    await family.patch(`/api/family/photos/${photoId}`).send({ cropY: 0.5 }).expect(400);
    // A zero-size crop is a mis-tap.
    await family
      .patch(`/api/family/photos/${photoId}`)
      .send({ cropWidth: 0 })
      .expect(400);

    // Choosing the portrait again without a crop keeps the stored one.
    const again = await family.put("/api/family/portrait").send({ photoId }).expect(200);
    expect(again.body).toMatchObject(RIGHT_SIDE);

    // And a caption edit never touches it.
    const captioned = await family
      .patch(`/api/family/photos/${photoId}`)
      .send({ caption: "Mum at Whitby" })
      .expect(200);
    expect(captioned.body).toMatchObject(RIGHT_SIDE);
  });

  it("holds the director's console to the same rule, and lets them undo a crop", async () => {
    const staff = await signUpHome();
    const { family, photoId } = await withPortraitPhoto(staff, await twoToneJpeg());
    await family.put("/api/family/portrait").send({ photoId, ...RIGHT_SIDE }).expect(200);

    await staff.agent.patch(`/api/photos/${photoId}`).send({ cropX: 0.9 }).expect(400);

    // The whole photograph is how a director puts a bad midnight crop right.
    const reset = await staff.agent
      .patch(`/api/photos/${photoId}`)
      .send({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })
      .expect(200);
    expect(reset.body).toMatchObject({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 });
  });
});

describe("where the portrait is printed", () => {
  it("cuts the prayer card's picture to the family's crop, and only the card's copy", async () => {
    const staff = await signUpHome();
    const { row, family, photoId } = await withPortraitPhoto(staff, await twoToneJpeg());

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    // Before any crop: the whole photograph goes into the card.
    await family.put("/api/family/portrait").send({ photoId }).expect(200);
    const whole = await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200);
    const wholePhoto = await embedded(whole.text, 'class="photo"');
    expect([wholePhoto.width, wholePhoto.height]).toEqual([400, 200]);

    await family.put("/api/family/portrait").send({ photoId, ...RIGHT_SIDE }).expect(200);
    const render = await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200);
    const card = await embedded(render.text, 'class="photo"');

    expect(card.width).toBe(128);
    expect(card.height).toBe(160);
    // The blue half, which is what was framed.
    expect(card.dominant.b).toBeGreaterThan(200);
    expect(card.dominant.r).toBeLessThan(60);

    // The family's copy of the proof is the same card.
    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ sharedWithFamily: true })
      .expect(200);
    const theirs = await family.get(`/api/family/print/${item.body.id}/render`).expect(200);
    expect(theirs.text).toBe(render.text);
  });

  it("applies the crop to the photograph the way the family saw it, rotation and all", async () => {
    const staff = await signUpHome();
    // Stored on its side with an EXIF flag, as phones do: displayed, it is
    // 200 wide and 400 tall, red on top and blue underneath.
    const { row, family, photoId } = await withPortraitPhoto(
      staff,
      await twoToneJpeg({ orientation: 6 }),
    );

    // The bottom half as displayed.
    await family
      .put("/api/family/portrait")
      .send({ photoId, cropX: 0.1, cropY: 0.55, cropWidth: 0.8, cropHeight: 0.4 })
      .expect(200);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "bookmark" })
      .expect(201);
    const render = await staff.agent.get(`/api/print/${item.body.id}/render`).expect(200);
    const card = await embedded(render.text, 'class="photo"');

    expect(card.width).toBe(160);
    expect(card.height).toBe(160);
    expect(card.dominant.b).toBeGreaterThan(200);
    expect(card.dominant.r).toBeLessThan(60);
  });

  it("frames the memory book's cover the same way, and leaves the plates whole", async () => {
    const staff = await signUpHome();
    const { row, family, photoId } = await withPortraitPhoto(staff, await twoToneJpeg());
    await family.put("/api/family/portrait").send({ photoId, ...RIGHT_SIDE }).expect(200);

    const other = await family
      .post("/api/family/photos")
      .attach("file", await twoToneJpeg(), "other.jpg")
      .expect(201);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [photoId, other.body.id] })
      .expect(200);

    const book = await staff.agent
      .get(`/api/cases/${row.id}/memory-book/render`)
      .expect(200);

    const cover = await embedded(book.text, 'class="cover-photo"');
    expect(cover.width / cover.height).toBeCloseTo(128 / 160, 2);
    expect(cover.dominant.b).toBeGreaterThan(200);

    // The other photograph is a plate, shown whole.
    const coverAt = book.text.indexOf('class="cover-photo"');
    const afterCover = book.text.slice(book.text.indexOf('alt=""', coverAt));
    const plate = await embedded(afterCover, "data:image");
    expect(plate.width / plate.height).toBeCloseTo(2, 1);
  });
});
