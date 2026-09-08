import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, passwordResetsTable, usersTable } from "@workspace/db";
import { createPasswordReset } from "../src/lib/auth";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

afterAll(closeDatabase);

const PASSWORD = "a-long-enough-passphrase";
const NEW_PASSWORD = "an-entirely-new-passphrase";

describe("forgetting a password", () => {
  useCleanDatabase();

  it("answers identically whether or not the account exists", async () => {
    const account = await signUp();

    const known = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: account.email })
      .expect(204);

    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody-at-all@example.test" })
      .expect(204);

    // Same status, same (empty) body. This endpoint must not become a way to
    // discover who has an account on a site for bereaved parents.
    expect(known.body).toEqual(unknown.body);
    expect(known.text).toEqual(unknown.text);
  });

  it("creates a token for a real account and none for a stranger", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: account.email })
      .expect(204);
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody-at-all@example.test" })
      .expect(204);

    const rows = await db.select().from(passwordResetsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(account.id);
  });

  it("stores the token as a digest, never in the clear", async () => {
    const account = await signUp();
    const token = await createPasswordReset(account.id);

    const [row] = await db.select().from(passwordResetsTable);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the address case-insensitively", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: account.email.toUpperCase() })
      .expect(204);

    expect(await db.select().from(passwordResetsTable)).toHaveLength(1);
  });
});

describe("resetting a password", () => {
  useCleanDatabase();

  it("sets the new password and lets the account back in", async () => {
    const account = await signUp();
    const token = await createPasswordReset(account.id);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(204);

    await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: NEW_PASSWORD })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .send({ email: account.email, password: PASSWORD })
      .expect(401);
  });

  it("refuses to be used twice", async () => {
    const account = await signUp();
    const token = await createPasswordReset(account.id);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(204);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "yet-another-passphrase" })
      .expect(400);
  });

  it("refuses an expired token", async () => {
    const account = await signUp();
    const token = await createPasswordReset(account.id);

    await db
      .update(passwordResetsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) });

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(400);
  });

  it("refuses a made-up token", async () => {
    await signUp();

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: NEW_PASSWORD })
      .expect(400);
  });

  it("refuses a password that is too short", async () => {
    const account = await signUp();
    const token = await createPasswordReset(account.id);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "short" })
      .expect(400);
  });

  it("signs out every existing session", async () => {
    const account = await signUp();

    // The account is signed in somewhere — possibly whoever they are locked
    // out by.
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", account.cookie)
      .expect(200);

    const token = await createPasswordReset(account.id);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(204);

    await request(app)
      .get("/api/auth/me")
      .set("Cookie", account.cookie)
      .expect(401);
  });

  it("voids every other outstanding link", async () => {
    const account = await signUp();
    const first = await createPasswordReset(account.id);
    const second = await createPasswordReset(account.id);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: second, newPassword: NEW_PASSWORD })
      .expect(204);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: first, newPassword: "a-third-passphrase-entirely" })
      .expect(400);
  });

  it("cannot reach another account's data", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const token = await createPasswordReset(alice.id);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: NEW_PASSWORD })
      .expect(204);

    // Bob's password is untouched.
    await request(app)
      .post("/api/auth/login")
      .send({ email: bob.email, password: PASSWORD })
      .expect(200);

    const [bobRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, bob.id));
    expect(bobRow.passwordHash).not.toBeNull();
  });
});
