import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";
import { MAX_PHOTOS_PER_CASE } from "@workspace/db";

describe("the health check reports on the database", () => {
  it("is not a constant", async () => {
    const res = await request(app).get("/api/healthz").expect(200);

    // A process that is up but cannot reach Postgres serves errors on every
    // screen, so "ok" has to mean the database answered.
    expect(res.body.status).toBe("ok");
    expect(res.body.database).toBe(true);
    // Reported, never fatal: a home without Twilio is degraded, not down.
    expect(res.body).toHaveProperty("mail");
    expect(res.body).toHaveProperty("sms");
  });
});

describe("finding an old case", () => {
  it("matches on any of the names a director might remember", async () => {
    const staff = await signUpHome();
    await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
    });
    await createCase(staff, {
      decedentFirstName: "Ronald",
      decedentLastName: "Okonkwo",
    });

    const byLast = await staff.agent.get("/api/cases?search=hale").expect(200);
    expect(byLast.body).toHaveLength(1);

    // The one they were actually called.
    const byPreferred = await staff.agent
      .get("/api/cases?search=peggy")
      .expect(200);
    expect(byPreferred.body).toHaveLength(1);

    // Case-insensitive and partial, because nobody types it exactly.
    const partial = await staff.agent.get("/api/cases?search=OKON").expect(200);
    expect(partial.body[0].decedentLastName).toBe("Okonkwo");

    const none = await staff.agent.get("/api/cases?search=zzzz").expect(200);
    expect(none.body).toHaveLength(0);
  });

  it("bounds the list rather than returning every case ever", async () => {
    const staff = await signUpHome();
    for (let i = 0; i < 5; i += 1) {
      await createCase(staff, { decedentLastName: `Case${i}` });
    }

    const limited = await staff.agent.get("/api/cases?limit=2").expect(200);
    expect(limited.body).toHaveLength(2);
  });
});

describe("the photo cap holds", () => {
  it("refuses the fifty-first and says why", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // Fill the case to the cap directly, so the test is about the boundary
    // rather than about uploading fifty files through multer.
    const { db, casePhotosTable, uploadsTable } = await import("@workspace/db");
    const { encryptBuffer } = await import("@workspace/db/crypto");

    for (let i = 0; i < MAX_PHOTOS_PER_CASE; i += 1) {
      const [upload] = await db
        .insert(uploadsTable)
        .values({
          funeralHomeId: 1,
          caseId: row.id,
          filename: `seed-${i}.png`,
          mimeType: "image/png",
          sizeBytes: PNG_BYTES.length,
          data: encryptBuffer(PNG_BYTES),
        })
        .returning();

      await db.insert(casePhotosTable).values({
        funeralHomeId: 1,
        caseId: row.id,
        uploadId: upload!.id,
        position: i,
      });
    }

    const refused = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "one-too-many.png")
      .expect(400);

    // Told plainly, with a way forward, rather than silently dropped.
    expect(refused.body.error).toContain(String(MAX_PHOTOS_PER_CASE));
  });
});
