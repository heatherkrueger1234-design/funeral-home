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

/** Invite a colleague with the given role and return their signed-in agent. */
async function colleague(
  owner: Awaited<ReturnType<typeof signUpHome>>,
  role: "director" | "staff",
) {
  const email = `${role}-${Math.random().toString(36).slice(2)}@example.com`;
  const invited = await owner.agent
    .post("/api/home/staff")
    .send({ email, displayName: "Ray Ochoa", role })
    .expect(201);

  const token = String(invited.body.inviteLink).split("token=")[1]!;
  const request = (await import("supertest")).default;
  const app = (await import("../src/app")).default;
  const agent = request.agent(app);
  await agent
    .post("/api/auth/reset-password")
    .send({ token: decodeURIComponent(token), password: "another-long-pass" })
    .expect(204);
  await agent
    .post("/api/auth/login")
    .send({ email, password: "another-long-pass" })
    .expect(200);
  return agent;
}

/**
 * Erasing a case is the owner's decision.
 *
 * It cannot be undone, it destroys photographs other people sent, and it is
 * how the home discharges a retention duty that belongs to the home. The
 * roles comment in `users.ts` gives the owner billing and staff and draws no
 * other line between director and staff, so the line drawn here is the
 * owner's.
 */
describe("permanently erasing a case", () => {
  for (const role of ["director", "staff"] as const) {
    it(`is refused to a ${role}, and the case survives`, async () => {
      const owner = await signUpHome();
      const kase = await createCase(owner);
      const agent = await colleague(owner, role);

      const refused = await agent
        .post(`/api/cases/${kase.id}/delete`)
        .send({ confirmName: "Margaret Hale" })
        .expect(403);
      expect(refused.body.error).toMatch(/owner/);

      await owner.agent.get(`/api/cases/${kase.id}`).expect(200);
      // They can still take a copy out, which is the way forward they are told.
      await agent.get(`/api/cases/${kase.id}/export`).expect(200);
    });
  }

  it("is refused before the case is looked up, so it reveals nothing", async () => {
    const owner = await signUpHome();
    const agent = await colleague(owner, "director");

    await agent
      .post(`/api/cases/999999/delete`)
      .send({ confirmName: "Nobody" })
      .expect(403);
  });

  it("still works for the owner", async () => {
    const owner = await signUpHome();
    const kase = await createCase(owner);

    await owner.agent
      .post(`/api/cases/${kase.id}/delete`)
      .send({ confirmName: "Margaret Hale" })
      .expect(204);
    await owner.agent.get(`/api/cases/${kase.id}`).expect(404);
  });
});

/**
 * Never ask twice: the obituary's born and died lines come from the case.
 *
 * Dates are stored as midnight UTC on the day, so they must print as that
 * day, not the evening before in the home's zone.
 */
describe("the obituary knows the dates the case knows", () => {
  it("is opened with born and died already filled", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff, {
      dateOfBirth: "1942-03-04T00:00:00.000Z",
      dateOfDeath: "2026-09-20T00:00:00.000Z",
    });
    const { token } = await inviteFamily(staff, kase.id);

    const theirs = await asFamily(token).get("/api/family/obituary").expect(200);
    expect(theirs.body.bornOn).toBe("March 4, 1942");
    expect(theirs.body.diedOn).toBe("September 20, 2026");

    const ours = await staff.agent
      .get(`/api/cases/${kase.id}/obituary`)
      .expect(200);
    expect(ours.body.bornOn).toBe("March 4, 1942");
  });

  it("fills an empty line when a date arrives later, and never overwrites the family", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);
    const { token } = await inviteFamily(staff, kase.id);

    // Nothing to fill yet, and the family writes it their own way.
    await asFamily(token)
      .put("/api/family/obituary")
      .send({ bornOn: "the spring of 1931, in a farmhouse" })
      .expect(200);

    await staff.agent
      .put(`/api/cases/${kase.id}`)
      .send({
        dateOfBirth: "1931-04-11T00:00:00.000Z",
        dateOfDeath: "2026-09-19T00:00:00.000Z",
      })
      .expect(200);

    const draft = await asFamily(token).get("/api/family/obituary").expect(200);
    expect(draft.body.bornOn).toBe("the spring of 1931, in a farmhouse");
    expect(draft.body.diedOn).toBe("September 19, 2026");

    // A correction by the home does not overwrite a line already filled,
    // even one this software filled: somebody may have read and kept it.
    await staff.agent
      .put(`/api/cases/${kase.id}`)
      .send({ dateOfDeath: "2026-09-18T00:00:00.000Z" })
      .expect(200);
    const again = await asFamily(token).get("/api/family/obituary").expect(200);
    expect(again.body.diedOn).toBe("September 19, 2026");
  });

  it("does not touch an obituary that has been approved for print", async () => {
    const staff = await signUpHome();
    const kase = await createCase(staff);

    await staff.agent
      .put(`/api/cases/${kase.id}/obituary`)
      .send({ biography: "She kept bees.", draftText: "Margaret Hale kept bees." })
      .expect(200);
    await staff.agent.post(`/api/cases/${kase.id}/obituary/approve`).expect(200);

    await staff.agent
      .put(`/api/cases/${kase.id}`)
      .send({ dateOfDeath: "2026-09-19T00:00:00.000Z" })
      .expect(200);

    const draft = await staff.agent
      .get(`/api/cases/${kase.id}/obituary`)
      .expect(200);
    expect(draft.body.diedOn).toBeNull();
  });

  it("gets the date of death when a pre-need planner dies, keeping what they wrote", async () => {
    const staff = await signUpHome();
    const plan = await createCase(staff, {
      kind: "pre_need",
      dateOfBirth: "1948-06-02T00:00:00.000Z",
    });
    await staff.agent
      .put(`/api/cases/${plan.id}/obituary`)
      .send({ bornOn: "1948, in Pueblo" })
      .expect(200);

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({ dateOfDeath: "2026-09-21T00:00:00.000Z" })
      .expect(200);

    const draft = await staff.agent
      .get(`/api/cases/${plan.id}/obituary`)
      .expect(200);
    expect(draft.body.bornOn).toBe("1948, in Pueblo");
    expect(draft.body.diedOn).toBe("September 21, 2026");
  });
});
