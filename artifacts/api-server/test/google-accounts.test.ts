import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable, toPublicUser } from "@workspace/db";
import { createSession } from "../src/lib/auth";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

afterAll(closeDatabase);

/**
 * A Google account, as the OAuth callback would leave it: a row with a Google
 * id, a verified address and no password at all. These cases cover what the
 * rest of the app does with such an account, which is where the real risk is
 * — every flow that used to assume `passwordHash` was a string.
 */
async function createGoogleAccount(email = "google-person@example.test") {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: null,
      googleId: `google-sub-${email}`,
      emailVerified: true,
      displayName: "A Parent",
    })
    .returning();

  const token = await createSession(user.id);
  return { user, cookie: `mh_session=${token}` };
}

describe("accounts with no password", () => {
  useCleanDatabase();

  it("cannot be signed into with a password, and says nothing about why", async () => {
    const { user } = await createGoogleAccount();

    const noPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "anything-at-all-here" })
      .expect(401);

    const noAccount = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.test", password: "anything-at-all-here" })
      .expect(401);

    // Identical, so the response cannot be used to discover that an address
    // is registered — only that it did not sign in.
    expect(noPassword.body).toEqual(noAccount.body);
  });

  it("is never sent a reset link, because there is nothing to reset", async () => {
    const { user } = await createGoogleAccount();

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: user.email })
      .expect(204);

    const { passwordResetsTable } = await import("@workspace/db");
    expect(await db.select().from(passwordResetsTable)).toHaveLength(0);
  });

  it("reports itself as passwordless so the UI can adapt", async () => {
    const { cookie } = await createGoogleAccount();

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);

    expect(me.body.hasPassword).toBe(false);
    expect(me.body.hasGoogle).toBe(true);
    expect(me.body).not.toHaveProperty("passwordHash");
    expect(me.body).not.toHaveProperty("googleId");
  });

  it("can add a password without proving one it never had", async () => {
    const { user, cookie } = await createGoogleAccount();

    await request(app)
      .put("/api/auth/password")
      .set("Cookie", cookie)
      .send({ newPassword: "a-brand-new-passphrase" })
      .expect(204);

    // And can now sign in either way.
    await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "a-brand-new-passphrase" })
      .expect(200);
  });

  it("can be deleted by confirming the address", async () => {
    const { user, cookie } = await createGoogleAccount();

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", cookie)
      .send({ confirmEmail: "the-wrong-address@example.test" })
      .expect(403);

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", cookie)
      .send({ confirmEmail: user.email.toUpperCase() })
      .expect(204);

    const remaining = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.id));
    expect(remaining).toHaveLength(0);
  });

  it("cannot be deleted with an empty confirmation", async () => {
    const { cookie } = await createGoogleAccount();

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", cookie)
      .send({})
      .expect(403);
  });
});

describe("accounts with a password", () => {
  useCleanDatabase();

  it("still need the current one to change it", async () => {
    const account = await signUp();

    await request(app)
      .put("/api/auth/password")
      .set("Cookie", account.cookie)
      .send({ newPassword: "a-brand-new-passphrase" })
      .expect(400);

    await request(app)
      .put("/api/auth/password")
      .set("Cookie", account.cookie)
      .send({
        currentPassword: "a-long-enough-passphrase",
        newPassword: "a-brand-new-passphrase",
      })
      .expect(204);
  });

  it("cannot be deleted by typing the address instead of the password", async () => {
    const account = await signUp();

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", account.cookie)
      .send({ confirmEmail: account.email })
      .expect(403);
  });

  it("report hasPassword so the UI shows the right control", async () => {
    const account = await signUp();
    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", account.cookie);

    expect(me.body.hasPassword).toBe(true);
    expect(me.body.hasGoogle).toBe(false);
  });
});

describe("what the server advertises", () => {
  useCleanDatabase();

  it("lists sign-in methods without needing a session", async () => {
    const res = await request(app).get("/api/auth/methods").expect(200);

    expect(res.body).toHaveProperty("google");
    expect(res.body).toHaveProperty("passwordReset");
  });

  it("refuses the Google routes when it is not configured", async () => {
    // No GOOGLE_CLIENT_ID in the test environment.
    await request(app).get("/api/auth/google").expect(404);
    await request(app).get("/api/auth/google/callback").expect(404);
  });
});

describe("the public shape of a user", () => {
  it("never carries the hash or the Google id", () => {
    const shaped = toPublicUser({
      id: 1,
      email: "someone@example.test",
      passwordHash: "scrypt$16384$8$1$abc$def",
      googleId: "google-sub-123",
      emailVerified: true,
      displayName: null,
      screenName: null,
      isModerator: false,
      resurfacingEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(JSON.stringify(shaped)).not.toContain("scrypt");
    expect(JSON.stringify(shaped)).not.toContain("google-sub-123");
    expect(shaped.hasPassword).toBe(true);
    expect(shaped.hasGoogle).toBe(true);
  });
});
