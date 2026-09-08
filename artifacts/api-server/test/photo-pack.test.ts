import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

    await staff.agent
      .put(`/api/cases/${row.id}/photos/order`)
      .send({ photoIds: [second.body.id, first.body.id, hidden.body.id] })
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

    // Two visible photographs plus the manifest. The hidden one is absent,
    // because hiding it should mean it is not in the slideshow.
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
});
