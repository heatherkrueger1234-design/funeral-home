import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, sharesTable } from "@workspace/db";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

/**
 * Share links are the single place this application returns somebody's private
 * writing without a session, so the cases here are mostly about what a link
 * must *not* do: widen to a second row, survive revocation, resolve against
 * another account's memory, or leave a working token in the database.
 */

afterAll(closeDatabase);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Distinguishable from PNG by its bytes, so "which file came back" is testable. */
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

async function createMemory(cookie: string, title: string, imageUrl?: string) {
  const created = await request(app)
    .post("/api/memories")
    .set("Cookie", cookie)
    .send({ title, ...(imageUrl ? { imageUrl } : {}) })
    .expect(201);
  return created.body as { id: number };
}

describe("share links", () => {
  useCleanDatabase();

  it("opens a shared memory for someone with no account at all", async () => {
    const parent = await signUp();
    const memory = await createMemory(parent.cookie, "The day at the lake");

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    expect(share.body.token).toBeTruthy();
    expect(share.body.url).toBe(`/shared/${share.body.token}`);

    // No cookie: this is the whole point of the feature.
    const seen = await request(app)
      .get(`/api/shared/${share.body.token}`)
      .expect(200);

    expect(seen.body.title).toBe("The day at the lake");
    expect(seen.body.kind).toBe("memory");
  });

  it("stores only the digest, so a database dump hands out no working links", async () => {
    const parent = await signUp();
    const memory = await createMemory(parent.cookie, "A quiet one");

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    const [row] = await db
      .select()
      .from(sharesTable)
      .where(eq(sharesTable.id, share.body.id));

    expect(row!.tokenHash).not.toBe(share.body.token);
    expect(row!.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(share.body.token);
  });

  it("never returns the token again after creation", async () => {
    const parent = await signUp();
    const memory = await createMemory(parent.cookie, "Only once");

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    const listed = await request(app)
      .get("/api/shares")
      .set("Cookie", parent.cookie)
      .expect(200);

    expect(listed.body).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(share.body.token);
    expect(listed.body[0].tokenHash).toBeUndefined();
  });

  it("stops working the moment it is revoked", async () => {
    const parent = await signUp();
    const memory = await createMemory(parent.cookie, "Revoke me");

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    await request(app).get(`/api/shared/${share.body.token}`).expect(200);

    await request(app)
      .delete(`/api/shares/${share.body.id}`)
      .set("Cookie", parent.cookie)
      .expect(204);

    await request(app).get(`/api/shared/${share.body.token}`).expect(404);
  });

  it("dies with the memory it points at", async () => {
    const parent = await signUp();
    const memory = await createMemory(parent.cookie, "Deleted later");

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    await request(app)
      .delete(`/api/memories/${memory.id}`)
      .set("Cookie", parent.cookie)
      .expect(204);

    await request(app).get(`/api/shared/${share.body.token}`).expect(404);
  });

  it("refuses to mint a link to another account's memory", async () => {
    const parent = await signUp();
    const stranger = await signUp();
    const memory = await createMemory(parent.cookie, "Not yours");

    await request(app)
      .post("/api/shares")
      .set("Cookie", stranger.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(404);
  });

  it("answers the same 404 for a made-up token as for a revoked one", async () => {
    const made_up = await request(app).get("/api/shared/not-a-real-token").expect(404);
    expect(JSON.stringify(made_up.body)).not.toContain("revoked");
  });

  it("cannot be turned into a reader for the account's other files", async () => {
    const parent = await signUp();

    const shared = await request(app)
      .post("/api/uploads")
      .set("Cookie", parent.cookie)
      .attach("file", PNG, "shared.png")
      .expect(201);

    const private_ = await request(app)
      .post("/api/uploads")
      .set("Cookie", parent.cookie)
      .attach("file", GIF, "private.gif")
      .expect(201);

    const memory = await createMemory(parent.cookie, "With a photo", shared.body.url);

    const share = await request(app)
      .post("/api/shares")
      .set("Cookie", parent.cookie)
      .send({ kind: "memory", resourceId: memory.id })
      .expect(201);

    const seen = await request(app)
      .get(`/api/shared/${share.body.token}`)
      .expect(200);

    // The private uploads URL is rewritten to the public one, so the viewer is
    // never handed an id to substitute in the first place: the endpoint takes
    // a token and reads the upload id off the shared memory itself.
    expect(seen.body.imageUrl).toBe(`/api/shared/${share.body.token}/image`);

    const image = await request(app).get(seen.body.imageUrl).expect(200);
    // The shared photograph, and specifically not the other one.
    expect(Buffer.from(image.body)).toEqual(PNG);
    expect(Buffer.from(image.body)).not.toEqual(GIF);
    expect(image.headers["content-type"]).toContain("image/png");

    // And the ordinary uploads route is still closed to an anonymous caller,
    // for the shared file as much as the private one.
    await request(app).get(private_.body.url).expect(401);
    await request(app).get(shared.body.url).expect(401);
  });
});
