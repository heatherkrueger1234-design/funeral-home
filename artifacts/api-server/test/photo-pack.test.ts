import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * The pack is the director's deliverable, so it is checked by actually
 * unzipping it with a tool that did not write it. A test that only asserts
 * "200 and some bytes" would pass on a corrupt archive, which is precisely
 * the failure that would matter — discovered on the morning of a funeral.
 */
describe("the photo pack", () => {
  it("unzips, is in slideshow order, and carries the captions", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });

    const first = await asFamily(token)
      .post("/api/family/photos")
      .field("caption", "At Skegness")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    const second = await asFamily(token)
      .post("/api/family/photos")
      .field("caption", "Wedding day")
      .attach("file", PNG_BYTES, "b.png")
      .expect(201);

    const hidden = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "c.png")
      .expect(201);

    // The director hides one and puts the wedding first.
    await staff.agent
      .patch(`/api/photos/${hidden.body.id}`)
      .send({ status: "hidden" })
      .expect(200);

    // The pack is the slideshow, so the selection is what decides both what
    // is in it and the order.
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [second.body.id, first.body.id] })
      .expect(200);

    const pack = await staff.agent
      .get(`/api/cases/${row.id}/photo-pack`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(pack.headers["content-type"]).toBe("application/zip");
    expect(pack.headers["content-disposition"]).toContain("Margaret-Hale");

    // Unzip it with the system tool, which knows nothing about our writer.
    const dir = mkdtempSync(path.join(tmpdir(), "pack-"));
    const zipPath = path.join(dir, "pack.zip");
    writeFileSync(zipPath, pack.body as Buffer);

    execFileSync("unzip", ["-q", zipPath, "-d", path.join(dir, "out")]);
    const files = readdirSync(path.join(dir, "out")).sort();

    // Two chosen photographs plus the manifest. The third is absent because
    // it was never selected -- and it is still in the bin, not deleted.
    expect(files).toHaveLength(3);
    expect(files.filter((f) => f.endsWith(".png"))).toHaveLength(2);

    // Numbered in the order the director set, not upload order.
    expect(files[0]).toMatch(/^01-Wedding-day\./);
    expect(files[1]).toMatch(/^02-At-Skegness\./);

    const captions = readFileSync(
      path.join(dir, "out", "captions.txt"),
      "utf8",
    );
    expect(captions).toContain("Margaret Hale");
    expect(captions).toContain("01. Wedding day");
    expect(captions).toContain("from Anne Hale");

    // And the bytes survived the round trip intact.
    const extracted = readFileSync(path.join(dir, "out", files[0]!));
    expect(extracted.equals(PNG_BYTES)).toBe(true);
  });

  it("says so plainly when there is nothing to pack", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent.get(`/api/cases/${row.id}/photo-pack`).expect(400);
  });

  /*
   * An archive here cannot pass 4 GB. Finding that out part-way through,
   * after the 200 had gone, handed a director a file that would not open to
   * the end. The sizes are recorded large rather than written large: what is
   * under test is that the pack asks before it starts.
   */
  it("refuses a selection too large for one archive before writing any of it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });

    const ids: number[] = [];
    for (const name of ["a.png", "b.png", "c.png"]) {
      const res = await asFamily(token)
        .post("/api/family/photos")
        .attach("file", PNG_BYTES, name)
        .expect(201);
      ids.push(res.body.id);
    }
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: ids })
      .expect(200);
    await db
      .update(uploadsTable)
      .set({ sizeBytes: 2_000_000_000 })
      .where(eq(uploadsTable.caseId, row.id));

    const res = await staff.agent.get(`/api/cases/${row.id}/photo-pack`).expect(413);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("asks for a selection rather than dumping the whole bin", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // Photographs uploaded but none chosen yet.
    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    const refused = await staff.agent
      .get(`/api/cases/${row.id}/photo-pack`)
      .expect(400);

    expect(refused.body.error).toMatch(/chosen/i);
  });

  it("keeps an unselected photograph in the bin", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const a = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);
    const b = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "b.png")
      .expect(201);

    await asFamily(token)
      .put("/api/family/photos/selection")
      .send({ photoIds: [a.body.id] })
      .expect(200);

    // Choosing one does not throw the other away.
    const bin = await asFamily(token).get("/api/family/photos").expect(200);
    expect(bin.body).toHaveLength(2);
    expect(bin.body.find((p: { id: number }) => p.id === b.body.id).selected).toBe(false);

    // Selected photographs sort to the front, in slideshow order.
    expect(bin.body[0].id).toBe(a.body.id);
  });
});

describe("the slideshow order", () => {
  it("is rewritten from the list the director gives, and nothing else", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });
    const family = asFamily(token);

    const ids: number[] = [];
    for (const name of ["a.png", "b.png", "c.png"]) {
      const photo = await family.post("/api/family/photos").attach("file", PNG_BYTES, name).expect(201);
      ids.push(photo.body.id);
    }
    const [a, b, c] = ids as [number, number, number];

    // The order is the slideshow's, so the bin is chronological until the
    // photographs are chosen (see `photosForCase`).
    await staff.agent
      .put(`/api/cases/${row.id}/photos/selection`)
      .send({ photoIds: [a, b, c] })
      .expect(200);

    const reordered = await staff.agent
      .put(`/api/cases/${row.id}/photos/order`)
      .send({ photoIds: [c, a, b] })
      .expect(200);
    expect(reordered.body.map((photo: { id: number }) => photo.id)).toEqual([c, a, b]);

    // And it stays that way when the list is read again.
    const listed = await staff.agent.get(`/api/cases/${row.id}/photos`).expect(200);
    expect(listed.body.map((photo: { id: number }) => photo.id)).toEqual([c, a, b]);
  });

  it("refuses a photograph from another case, and one listed twice", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });
    const mine = await asFamily(token).post("/api/family/photos").attach("file", PNG_BYTES, "a.png").expect(201);

    const elsewhere = await createCase(staff, { decedentFirstName: "Harold" });
    const { token: otherToken } = await inviteFamily(staff, elsewhere.id, { name: "Tom Reyes" });
    const theirs = await asFamily(otherToken).post("/api/family/photos").attach("file", PNG_BYTES, "b.png").expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}/photos/order`)
      .send({ photoIds: [mine.body.id, theirs.body.id] })
      .expect(400);
    await staff.agent
      .put(`/api/cases/${row.id}/photos/order`)
      .send({ photoIds: [mine.body.id, mine.body.id] })
      .expect(400);
  });
});
