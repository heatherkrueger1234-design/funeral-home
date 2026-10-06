import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";
import { db, MAX_PHOTOS_PER_CASE } from "@workspace/db";
import { sql } from "drizzle-orm";
import { loggableError } from "../src/lib/http";

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

describe("passwords hashed with older settings", () => {
  it("still sign in, and are rehashed with today's settings when they do", async () => {
    const { scryptSync, randomBytes } = await import("node:crypto");
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { signUpHome } = await import("./helpers");

    const staff = await signUpHome();
    // As every password was stored before 5 October: N=2^14, r=8, p=1.
    const salt = randomBytes(16);
    const old = scryptSync("correct-horse-battery", salt, 64, { N: 16384, r: 8, p: 1 });
    const oldHash = `scrypt$16384$8$1$${salt.toString("base64")}$${old.toString("base64")}`;
    await db.update(usersTable).set({ passwordHash: oldHash }).where(eq(usersTable.id, staff.userId));

    const request = (await import("supertest")).default;
    const app = (await import("../src/app")).default;
    await request(app)
      .post("/api/auth/login")
      .send({ email: staff.email, password: "correct-horse-battery" })
      .expect(200);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, staff.userId));
    expect(user!.passwordHash).not.toBe(oldHash);
    expect(user!.passwordHash?.startsWith("scrypt$16384$8$5$")).toBe(true);

    // And the new hash is the same password.
    await request(app)
      .post("/api/auth/login")
      .send({ email: staff.email, password: "correct-horse-battery" })
      .expect(200);
    await request(app)
      .post("/api/auth/login")
      .send({ email: staff.email, password: "wrong-horse-battery" })
      .expect(401);
  });
});

describe("what the client got wrong is the client's", () => {
  /*
   * Each of these was a 500: an error log line and an error-tracker event
   * that anybody could send in a loop, before any rate limiter had run.
   */
  it("answers a body past the limit with 413", async () => {
    const staff = await signUpHome();
    await staff.agent
      .post("/api/cases")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ decedentFirstName: "x".repeat(1_100_000), decedentLastName: "Hale" }))
      .expect(413);
  });

  it("answers an encoding it cannot read with 415", async () => {
    await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "not-a-real-encoding")
      .send('{"email":"anne@example.com","password":"correct-horse-battery"}')
      .expect(415);
  });

  it("answers a date the database cannot hold with 400", async () => {
    const staff = await signUpHome();
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Hale", dateOfDeath: "200000-01-01" })
      .expect(400);
  });
});

describe("a failed query, written down", () => {
  /*
   * Drizzle puts every bound value of a failed query into its message, and
   * the logger and the error tracker both took the message as it was.
   */
  it("keeps the fault and loses the family's words", async () => {
    const failure = await db.execute(sql`select ${"Margaret Hale"}::int`).catch((error: unknown) => error);
    expect(String((failure as Error).message)).toContain("Margaret Hale");

    const written = loggableError(failure) as Error & { code?: string };
    expect(written.code).toBe("22P02");
    expect(written.message).toContain("22P02");
    for (const text of [written.message, written.stack ?? "", JSON.stringify(written)]) {
      expect(text).not.toContain("Margaret");
    }
  });
});
