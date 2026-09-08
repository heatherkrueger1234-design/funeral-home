import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

afterAll(closeDatabase);

describe("accounts and sessions", () => {
  useCleanDatabase();

  it("registers, signs in, and reports the current account", async () => {
    const account = await signUp();

    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(me.body.email).toBe(account.email);
    expect(me.body).not.toHaveProperty("passwordHash");
  });

  it("never returns the password hash", async () => {
    const account = await signUp();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: "a-long-enough-passphrase" })
      .expect(200);

    expect(JSON.stringify(login.body)).not.toContain("scrypt");
    expect(login.body).not.toHaveProperty("passwordHash");
  });

  it("stores the password as a scrypt hash, never as given", async () => {
    const account = await signUp();

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, account.id));

    expect(row.passwordHash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
    expect(row.passwordHash).not.toContain("a-long-enough-passphrase");
  });

  it("treats email as case-insensitive", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "Someone@Example.test", password: "a-long-enough-passphrase" })
      .expect(201);

    await request(app)
      .post("/api/auth/login")
      .send({ email: "SOMEONE@EXAMPLE.TEST", password: "a-long-enough-passphrase" })
      .expect(200);
  });

  it("rejects a duplicate registration", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/auth/register")
      .send({ email: account.email, password: "a-different-passphrase" })
      .expect(409);
  });

  it("rejects a password that is too short", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "short@example.test", password: "short" })
      .expect(400);
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const account = await signUp();

    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: "not-the-passphrase" })
      .expect(401);

    const unknownAccount = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.test", password: "not-the-passphrase" })
      .expect(401);

    // Identical wording, so the response cannot be used to discover which
    // email addresses have accounts.
    expect(wrongPassword.body).toEqual(unknownAccount.body);
  });

  it("ends the session on sign out", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", account.cookie)
      .expect(204);

    await request(app)
      .get("/api/auth/me")
      .set("Cookie", account.cookie)
      .expect(401);
  });

  it("revokes every session when the password changes", async () => {
    const account = await signUp();

    // A second device, signed in separately.
    const other = await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: "a-long-enough-passphrase" })
      .expect(200);
    const otherCookie = (other.headers["set-cookie"] as unknown as string[])[0]
      .split(";")[0];

    await request(app)
      .put("/api/auth/password")
      .set("Cookie", account.cookie)
      .send({
        currentPassword: "a-long-enough-passphrase",
        newPassword: "a-brand-new-passphrase",
      })
      .expect(204);

    // Changing a password is how someone locks out a device they no longer
    // control, so the other session must be dead too.
    await request(app).get("/api/auth/me").set("Cookie", otherCookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", account.cookie).expect(401);

    await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: "a-brand-new-passphrase" })
      .expect(200);
  });

  it("will not change a password without the current one", async () => {
    const account = await signUp();

    await request(app)
      .put("/api/auth/password")
      .set("Cookie", account.cookie)
      .send({ currentPassword: "wrong", newPassword: "a-brand-new-passphrase" })
      .expect(403);
  });

  it("rejects a forged session cookie", async () => {
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", "mh_session=made-up-token-value")
      .expect(401);
  });

  it("leaves health open", async () => {
    await request(app).get("/api/healthz").expect(200);
  });
});

describe("taking your data with you", () => {
  useCleanDatabase();

  it("exports everything the account has written", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "Her last birthday" })
      .expect(201);

    const exported = await request(app)
      .get("/api/auth/export")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(exported.body.account.email).toBe(account.email);
    expect(exported.body.data.memories).toHaveLength(1);
    expect(exported.headers["content-disposition"]).toContain("holding-today-export.json");
    expect(JSON.stringify(exported.body)).not.toContain("scrypt");
  });

  it("deletes the account and everything in it, and nothing else", async () => {
    const leaving = await signUp();
    const staying = await signUp();

    for (const account of [leaving, staying]) {
      await request(app)
        .post("/api/memories")
        .set("Cookie", account.cookie)
        .send({ title: "a memory" })
        .expect(201);
    }

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", leaving.cookie)
      .send({ password: "wrong-password-entirely" })
      .expect(403);

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", leaving.cookie)
      .send({ password: "a-long-enough-passphrase" })
      .expect(204);

    await request(app).get("/api/auth/me").set("Cookie", leaving.cookie).expect(401);

    const survivors = await request(app)
      .get("/api/memories")
      .set("Cookie", staying.cookie)
      .expect(200);

    expect(survivors.body).toHaveLength(1);

    const remaining = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, leaving.id));

    expect(remaining).toHaveLength(0);
  });
});

describe("rate limiting", () => {
  useCleanDatabase();

  it("stops repeated sign-in attempts against one account", async () => {
    const account = await signUp();

    // The limiter allows 20 attempts per window by default; useCleanDatabase
    // has just reset it, and signUp consumed one.
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: account.email, password: "wrong-password-guess" });

      statuses.push(response.status);
    }

    expect(statuses).toContain(401);
    expect(statuses.at(-1)).toBe(429);
  });

  it("does not rate limit ordinary reads", async () => {
    const account = await signUp();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(app)
        .get("/api/memories")
        .set("Cookie", account.cookie)
        .expect(200);
    }
  });
});
