import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

/**
 * The site's own guide tells people to switch off photo memory notifications,
 * because being ambushed by your dead child over breakfast is a different
 * thing from going to look on purpose. These cases hold this feature to that:
 * it is a door, and it must never reach into the places where the worst
 * writing lives.
 */

afterAll(closeDatabase);

/** Draws repeatedly, so a random pick cannot hide a forbidden source. */
async function drawMany(cookie: string, times = 60) {
  const seen: { kind?: string; body?: string; title?: string }[] = [];
  for (let i = 0; i < times; i++) {
    const res = await request(app)
      .get("/api/resurface")
      .set("Cookie", cookie)
      .expect(200);
    if (res.body.found) seen.push(res.body);
  }
  return seen;
}

describe("something you wrote", () => {
  useCleanDatabase();

  it("says there is nothing yet rather than inventing something", async () => {
    const account = await signUp();
    const res = await request(app)
      .get("/api/resurface")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(res.body.found).toBe(false);
  });

  it("never draws from the journal, the letters or the documents", async () => {
    const account = await signUp();

    // The three places the darkest writing lives.
    await request(app)
      .post("/api/journal")
      .set("Cookie", account.cookie)
      .send({ title: "JOURNAL", content: "PRIVATE_JOURNAL_TEXT", entryDate: "2026-01-01" })
      .expect(201);
    await request(app)
      .post("/api/letters")
      .set("Cookie", account.cookie)
      .send({ title: "LETTER", content: "PRIVATE_LETTER_TEXT", direction: "to_child" })
      .expect(201);
    await request(app)
      .post("/api/documents")
      .set("Cookie", account.cookie)
      .send({ title: "AUTOPSY", category: "autopsy", content: "PRIVATE_AUTOPSY_TEXT" })
      .expect(201);

    // And one thing it is allowed to draw.
    await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "The lake", description: "A good day." })
      .expect(201);

    const drawn = await drawMany(account.cookie);
    expect(drawn.length).toBeGreaterThan(0);

    const everything = JSON.stringify(drawn);
    expect(everything).not.toContain("PRIVATE_JOURNAL_TEXT");
    expect(everything).not.toContain("PRIVATE_LETTER_TEXT");
    expect(everything).not.toContain("PRIVATE_AUTOPSY_TEXT");
    // The only source available was the memory, so that is all it can be.
    expect(new Set(drawn.map((d) => d.kind))).toEqual(new Set(["memory"]));
  });

  it("draws from the safe places", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "The lake" })
      .expect(201);
    await request(app)
      .post("/api/quotes")
      .set("Cookie", account.cookie)
      .send({ text: "A line he loved", type: "song" })
      .expect(201);
    await request(app)
      .post("/api/keepsakes")
      .set("Cookie", account.cookie)
      .send({ promptId: "laugh", question: "What did his laugh sound like?", answer: "Silent." })
      .expect(201);
    await request(app)
      .post("/api/stories")
      .set("Cookie", account.cookie)
      .send({ authorName: "His coach", content: "He never missed a session." })
      .expect(201);

    const kinds = new Set((await drawMany(account.cookie, 120)).map((d) => d.kind));
    for (const kind of ["memory", "quote", "keepsake", "story"]) {
      expect(kinds).toContain(kind);
    }
  });

  it("goes quiet entirely when it is switched off", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "The lake" })
      .expect(201);

    await request(app)
      .put("/api/resurface/settings")
      .set("Cookie", account.cookie)
      .send({ enabled: false })
      .expect(200);

    const res = await request(app)
      .get("/api/resurface")
      .set("Cookie", account.cookie)
      .expect(200);
    expect(res.body.found).toBe(false);

    await request(app)
      .put("/api/resurface/settings")
      .set("Cookie", account.cookie)
      .send({ enabled: true })
      .expect(200);

    const back = await request(app)
      .get("/api/resurface")
      .set("Cookie", account.cookie)
      .expect(200);
    expect(back.body.found).toBe(true);
  });

  it("never reaches another account's writing", async () => {
    const alice = await signUp();
    const bob = await signUp();

    await request(app)
      .post("/api/memories")
      .set("Cookie", alice.cookie)
      .send({ title: "ALICES_MEMORY" })
      .expect(201);

    const bobsDraws = await drawMany(bob.cookie, 20);
    expect(bobsDraws).toEqual([]);
  });

  it("favours what was starred", async () => {
    const account = await signUp();

    const plain = await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "Ordinary" })
      .expect(201);
    const treasure = await request(app)
      .post("/api/memories")
      .set("Cookie", account.cookie)
      .send({ title: "Treasure" })
      .expect(201);

    await request(app)
      .post("/api/treasures")
      .set("Cookie", account.cookie)
      .send({ kind: "memory", id: treasure.body.id, starred: true })
      .expect(204);

    const drawn = await drawMany(account.cookie, 200);
    const starred = drawn.filter((d) => d.title === "Treasure").length;
    const ordinary = drawn.filter((d) => d.title === "Ordinary").length;

    // Weighted four to one, so a wide margin without being flaky.
    expect(starred).toBeGreaterThan(ordinary);
    expect(plain.body.isStarred).toBe(false);
  });

  it("keeps one answer per question rather than stacking them", async () => {
    const account = await signUp();

    await request(app)
      .post("/api/keepsakes")
      .set("Cookie", account.cookie)
      .send({ promptId: "laugh", question: "What did his laugh sound like?", answer: "Loud." })
      .expect(201);
    await request(app)
      .post("/api/keepsakes")
      .set("Cookie", account.cookie)
      .send({ promptId: "laugh", question: "What did his laugh sound like?", answer: "Actually, silent." })
      .expect(201);

    const all = await request(app)
      .get("/api/keepsakes")
      .set("Cookie", account.cookie)
      .expect(200);

    expect(all.body).toHaveLength(1);
    expect(all.body[0].answer).toBe("Actually, silent.");
  });

  it("is closed without a session", async () => {
    await request(app).get("/api/resurface").expect(401);
    await request(app).get("/api/keepsakes").expect(401);
    await request(app).post("/api/treasures").send({}).expect(401);
  });
});
