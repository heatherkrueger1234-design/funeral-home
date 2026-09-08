import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

/**
 * Albums point at photographs. They never own them.
 *
 * The case these tests exist for is somebody tidying their albums late at
 * night: deleting an album must delete the album and nothing else, because
 * the picture it pointed at may be the only one left of their child.
 */

afterAll(closeDatabase);

async function makeMemory(cookie: string, title: string, imageUrl = "/api/uploads/1") {
  const res = await request(app)
    .post("/api/memories")
    .set("Cookie", cookie)
    .send({ title, imageUrl })
    .expect(201);
  return res.body.id as number;
}

describe("albums", () => {
  useCleanDatabase();

  it("keeps the order it was given, not the order of the ids", async () => {
    const account = await signUp();
    const a = await makeMemory(account.cookie, "First made");
    const b = await makeMemory(account.cookie, "Second made");
    const c = await makeMemory(account.cookie, "Third made");

    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", account.cookie)
      .send({ title: "His last year" })
      .expect(201);

    // Deliberately not ascending.
    const res = await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [c, a, b] })
      .expect(200);

    expect(res.body.photos.map((p: { memoryId: number }) => p.memoryId)).toEqual([c, a, b]);

    // And it survives a re-read rather than only being right in the response.
    const again = await request(app)
      .get(`/api/albums/${album.body.id}`)
      .set("Cookie", account.cookie)
      .expect(200);
    expect(again.body.photos.map((p: { memoryId: number }) => p.memoryId)).toEqual([c, a, b]);
  });

  it("deleting an album never deletes a photograph", async () => {
    const account = await signUp();
    const memoryId = await makeMemory(account.cookie, "The only photo of him");

    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", account.cookie)
      .send({ title: "For his grandmother" })
      .expect(201);

    await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [memoryId] })
      .expect(200);

    await request(app)
      .delete(`/api/albums/${album.body.id}`)
      .set("Cookie", account.cookie)
      .expect(204);

    const memories = await request(app)
      .get("/api/memories")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(memories.body.map((m: { id: number }) => m.id)).toContain(memoryId);
  });

  it("removing a photo from an album leaves the photo alone", async () => {
    const account = await signUp();
    const keep = await makeMemory(account.cookie, "Stays");
    const drop = await makeMemory(account.cookie, "Removed from the album");

    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", account.cookie)
      .send({ title: "Christmases" })
      .expect(201);

    await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [keep, drop] })
      .expect(200);

    const after = await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [keep] })
      .expect(200);

    expect(after.body.photos).toHaveLength(1);

    const memories = await request(app)
      .get("/api/memories")
      .set("Cookie", account.cookie)
      .expect(200);
    expect(memories.body.map((m: { id: number }) => m.id)).toContain(drop);
  });

  it("one photograph can be in more than one album", async () => {
    const account = await signUp();
    const memoryId = await makeMemory(account.cookie, "Christmas, his last year");

    for (const title of ["Christmases", "His last year"]) {
      const album = await request(app)
        .post("/api/albums")
        .set("Cookie", account.cookie)
        .send({ title })
        .expect(201);
      await request(app)
        .put(`/api/albums/${album.body.id}/items`)
        .set("Cookie", account.cookie)
        .send({ memoryIds: [memoryId] })
        .expect(200);
    }

    const list = await request(app)
      .get("/api/albums")
      .set("Cookie", account.cookie)
      .expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.every((a: { photoCount: number }) => a.photoCount === 1)).toBe(true);
  });

  it("refuses the same photograph twice in one album", async () => {
    const account = await signUp();
    const memoryId = await makeMemory(account.cookie, "Once is enough");
    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", account.cookie)
      .send({ title: "Doubled" })
      .expect(201);

    await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [memoryId, memoryId] })
      .expect(400);
  });

  it("cannot put another account's photograph in an album", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const alicesMemory = await makeMemory(alice.cookie, "ALICES_PHOTO");

    const bobsAlbum = await request(app)
      .post("/api/albums")
      .set("Cookie", bob.cookie)
      .send({ title: "Bob's album" })
      .expect(201);

    await request(app)
      .put(`/api/albums/${bobsAlbum.body.id}/items`)
      .set("Cookie", bob.cookie)
      .send({ memoryIds: [alicesMemory] })
      .expect(400);

    const still = await request(app)
      .get(`/api/albums/${bobsAlbum.body.id}`)
      .set("Cookie", bob.cookie)
      .expect(200);
    expect(JSON.stringify(still.body)).not.toContain("ALICES_PHOTO");
  });

  it("cannot read, rename or delete another account's album", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", alice.cookie)
      .send({ title: "ALICES_ALBUM" })
      .expect(201);

    await request(app).get(`/api/albums/${album.body.id}`).set("Cookie", bob.cookie).expect(404);
    await request(app)
      .put(`/api/albums/${album.body.id}`)
      .set("Cookie", bob.cookie)
      .send({ title: "mine now" })
      .expect(404);
    await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", bob.cookie)
      .send({ memoryIds: [] })
      .expect(404);
    await request(app)
      .delete(`/api/albums/${album.body.id}`)
      .set("Cookie", bob.cookie)
      .expect(404);

    // Still Alice's, still named what she named it.
    const mine = await request(app)
      .get(`/api/albums/${album.body.id}`)
      .set("Cookie", alice.cookie)
      .expect(200);
    expect(mine.body.title).toBe("ALICES_ALBUM");
  });

  it("uses the first photograph in the chosen order as the cover", async () => {
    const account = await signUp();
    const first = await makeMemory(account.cookie, "Cover", "/api/uploads/7");
    const second = await makeMemory(account.cookie, "Not the cover", "/api/uploads/8");

    const album = await request(app)
      .post("/api/albums")
      .set("Cookie", account.cookie)
      .send({ title: "Covered" })
      .expect(201);
    await request(app)
      .put(`/api/albums/${album.body.id}/items`)
      .set("Cookie", account.cookie)
      .send({ memoryIds: [second, first] })
      .expect(200);

    const list = await request(app)
      .get("/api/albums")
      .set("Cookie", account.cookie)
      .expect(200);
    expect(list.body[0].coverImageUrl).toBe("/api/uploads/8");
  });

  it("is closed without a session", async () => {
    await request(app).get("/api/albums").expect(401);
    await request(app).post("/api/albums").send({ title: "x" }).expect(401);
    await request(app).get("/api/albums/1").expect(401);
    await request(app).put("/api/albums/1/items").send({ memoryIds: [] }).expect(401);
    await request(app).delete("/api/albums/1").expect(401);
  });
});
