import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

/**
 * The shared room is the only place in this application where one account can
 * read another's writing, so these cases are mostly about the boundaries of
 * that: what a reader may never learn about an author, what a hidden post must
 * never do, and who is allowed to hide one.
 */

afterAll(closeDatabase);

async function post(cookie: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/community/posts")
    .set("Cookie", cookie)
    .send({ kind: "signs", title: "The lights", body: "They flicker.", ...body })
    .expect(201);
}

/** Promotes an account, which in production is done by hand in the database. */
async function makeModerator(id: number) {
  await db.update(usersTable).set({ isModerator: true }).where(eq(usersTable.id, id));
}

describe("the shared room", () => {
  useCleanDatabase();

  it("is closed to anyone without an account", async () => {
    await request(app).get("/api/community/posts").expect(401);
    await request(app).post("/api/community/posts").send({}).expect(401);
    await request(app).get("/api/community/posts/1").expect(401);
  });

  it("lets one parent read what another wrote", async () => {
    const alice = await signUp();
    const bob = await signUp();

    await post(alice.cookie, { title: "A cardinal on the fence" });

    const seen = await request(app)
      .get("/api/community/posts")
      .set("Cookie", bob.cookie)
      .expect(200);

    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].title).toBe("A cardinal on the fence");
    // Bob did not write it, so he is not offered a delete.
    expect(seen.body[0].isMine).toBe(false);
  });

  it("never tells a reader who wrote something", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const created = await post(alice.cookie);

    const list = await request(app)
      .get("/api/community/posts")
      .set("Cookie", bob.cookie)
      .expect(200);
    const detail = await request(app)
      .get(`/api/community/posts/${created.body.id}`)
      .set("Cookie", bob.cookie)
      .expect(200);

    // Checked structurally rather than by substring: an author id is a small
    // integer that legitimately appears elsewhere in the payload, so the only
    // meaningful assertion is on the exact set of fields a reader receives.
    const POST_FIELDS = [
      "id", "screenName", "kind", "title", "body",
      "commentCount", "isMine", "createdAt",
    ].sort();

    expect(Object.keys(list.body[0]).sort()).toEqual(POST_FIELDS);
    expect(Object.keys(detail.body).sort()).toEqual(
      [...POST_FIELDS, "comments"].sort(),
    );

    for (const payload of [list.body, detail.body]) {
      const json = JSON.stringify(payload);
      expect(json).not.toContain(alice.email);
      expect(json).not.toContain("userId");
    }
  });

  it("assigns a screen name when one is not given, and keeps it", async () => {
    const account = await signUp();

    const first = await post(account.cookie);
    expect(first.body.screenName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d+$/);

    const second = await post(account.cookie, { title: "Again" });
    expect(second.body.screenName).toBe(first.body.screenName);
  });

  it("lets someone choose their own name, and refuses a borrowed authority", async () => {
    const account = await signUp();

    const chosen = await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", account.cookie)
      .send({ screenName: "Small Harbour" })
      .expect(200);
    expect(chosen.body.screenName).toBe("Small Harbour");

    for (const name of ["Moderator", "Holding Today", "admin", "Crisis Line"]) {
      await request(app)
        .put("/api/community/screen-name")
        .set("Cookie", account.cookie)
        .send({ screenName: name })
        .expect(400);
    }
  });

  it("refuses a name that is already taken", async () => {
    const alice = await signUp();
    const bob = await signUp();

    await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", alice.cookie)
      .send({ screenName: "Grey Meadow" })
      .expect(200);

    await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", bob.cookie)
      .send({ screenName: "Grey Meadow" })
      .expect(409);
  });

  it("strips characters that could be used to impersonate another name", async () => {
    const account = await signUp();

    const cleaned = await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", account.cookie)
      .send({ screenName: "Quiet‮ Harbour ‍🌙" })
      .expect(200);

    expect(cleaned.body.screenName).toBe("Quiet Harbour");
  });

  it("keeps the name a post was published under when the author renames", async () => {
    const account = await signUp();

    await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", account.cookie)
      .send({ screenName: "First Name" })
      .expect(200);

    const created = await post(account.cookie);
    expect(created.body.screenName).toBe("First Name");

    await request(app)
      .put("/api/community/screen-name")
      .set("Cookie", account.cookie)
      .send({ screenName: "Second Name" })
      .expect(200);

    // Renaming yourself must not silently rewrite conversations you were in.
    const detail = await request(app)
      .get(`/api/community/posts/${created.body.id}`)
      .set("Cookie", account.cookie)
      .expect(200);
    expect(detail.body.screenName).toBe("First Name");
  });

  it("carries replies, and counts only the visible ones", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const created = await post(alice.cookie);

    await request(app)
      .post(`/api/community/posts/${created.body.id}/comments`)
      .set("Cookie", bob.cookie)
      .send({ body: "This happened to us too." })
      .expect(201);

    const detail = await request(app)
      .get(`/api/community/posts/${created.body.id}`)
      .set("Cookie", alice.cookie)
      .expect(200);

    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.commentCount).toBe(1);
    expect(detail.body.comments[0].body).toBe("This happened to us too.");
    expect(detail.body.comments[0].isMine).toBe(false);
  });

  it("lets people remove their own words and nobody else's", async () => {
    const alice = await signUp();
    const bob = await signUp();

    const created = await post(alice.cookie);

    await request(app)
      .delete(`/api/community/posts/${created.body.id}`)
      .set("Cookie", bob.cookie)
      .expect(404);

    await request(app)
      .delete(`/api/community/posts/${created.body.id}`)
      .set("Cookie", alice.cookie)
      .expect(204);

    const after = await request(app)
      .get("/api/community/posts")
      .set("Cookie", bob.cookie)
      .expect(200);
    expect(after.body).toEqual([]);
  });

  it("flags a post that reads like the author is in danger, and still publishes it", async () => {
    const account = await signUp();

    const alarming = await post(account.cookie, {
      kind: "story",
      title: "I don't know",
      body: "I can't do this anymore. I want to die.",
    });

    // The post goes up. Refusing it would teach them that saying it gets
    // them silenced.
    expect(alarming.body.crisisPrompt).toBe(true);
    expect(alarming.body.id).toBeTruthy();

    const ordinary = await post(account.cookie, {
      kind: "story",
      title: "His birthday",
      body: "He would have been twenty-four today.",
    });
    expect(ordinary.body.crisisPrompt).toBe(false);
  });

  it("does not fire the crisis prompt on describing how a child died", async () => {
    const account = await signUp();

    // The most common thing on this site. A crisis banner here would be
    // shown to half the people describing their loss.
    const described = await post(account.cookie, {
      kind: "story",
      title: "How we lost him",
      body: "My son died by suicide in 2022. It was an overdose that took his friend.",
    });

    expect(described.body.crisisPrompt).toBe(false);
  });
});

describe("moderating the shared room", () => {
  useCleanDatabase();

  it("counts people rather than reports", async () => {
    const author = await signUp();
    const reporter = await signUp();
    const moderator = await signUp();
    await makeModerator(moderator.id);

    const created = await post(author.cookie);

    // The same person reporting three times is still one person.
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/community/reports")
        .set("Cookie", reporter.cookie)
        .send({ targetType: "post", targetId: created.body.id, reason: "cruel" })
        .expect(201);
    }

    const queue = await request(app)
      .get("/api/community/moderation/reports")
      .set("Cookie", moderator.cookie)
      .expect(200);

    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].reportCount).toBe(1);
    expect(queue.body[0].targetBody).toContain("They flicker.");
  });

  it("is closed to people who are not moderators", async () => {
    const ordinary = await signUp();

    await request(app)
      .get("/api/community/moderation/reports")
      .set("Cookie", ordinary.cookie)
      .expect(403);

    await request(app)
      .post("/api/community/moderation/hide")
      .set("Cookie", ordinary.cookie)
      .send({ targetType: "post", targetId: 1, hidden: true })
      .expect(403);
  });

  it("takes a hidden post out of every read path", async () => {
    const author = await signUp();
    const reader = await signUp();
    const moderator = await signUp();
    await makeModerator(moderator.id);

    const created = await post(author.cookie);

    await request(app)
      .post("/api/community/moderation/hide")
      .set("Cookie", moderator.cookie)
      .send({ targetType: "post", targetId: created.body.id, hidden: true, reason: "cruel" })
      .expect(204);

    // Gone from the listing, gone from the detail, and gone to its author too.
    const list = await request(app)
      .get("/api/community/posts")
      .set("Cookie", reader.cookie)
      .expect(200);
    expect(list.body).toEqual([]);

    await request(app)
      .get(`/api/community/posts/${created.body.id}`)
      .set("Cookie", reader.cookie)
      .expect(404);
    await request(app)
      .get(`/api/community/posts/${created.body.id}`)
      .set("Cookie", author.cookie)
      .expect(404);

    // And nobody can reply into it.
    await request(app)
      .post(`/api/community/posts/${created.body.id}/comments`)
      .set("Cookie", reader.cookie)
      .send({ body: "hello" })
      .expect(404);
  });

  it("can restore something it hid, and closes the reports either way", async () => {
    const author = await signUp();
    const reporter = await signUp();
    const moderator = await signUp();
    await makeModerator(moderator.id);

    const created = await post(author.cookie);
    await request(app)
      .post("/api/community/reports")
      .set("Cookie", reporter.cookie)
      .send({ targetType: "post", targetId: created.body.id, reason: "spam" })
      .expect(201);

    await request(app)
      .post("/api/community/moderation/hide")
      .set("Cookie", moderator.cookie)
      .send({ targetType: "post", targetId: created.body.id, hidden: false })
      .expect(204);

    const queue = await request(app)
      .get("/api/community/moderation/reports")
      .set("Cookie", moderator.cookie)
      .expect(200);
    expect(queue.body).toEqual([]);

    const list = await request(app)
      .get("/api/community/posts")
      .set("Cookie", reporter.cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("takes someone's posts with them when the account is deleted", async () => {
    const leaving = await signUp();
    const staying = await signUp();

    await post(leaving.cookie, { title: "Written before leaving" });

    await request(app)
      .delete("/api/auth/account")
      .set("Cookie", leaving.cookie)
      .send({ password: "a-long-enough-passphrase" })
      .expect(204);

    const list = await request(app)
      .get("/api/community/posts")
      .set("Cookie", staying.cookie)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
