import request from "supertest";
import { describe, expect, it, afterAll } from "vitest";
import { app, closeDatabase, signUp, useCleanDatabase } from "./helpers";

/**
 * The suite that matters most.
 *
 * This application stores what a bereaved parent wrote about their child. The
 * original schema had no owner column and no query filtered by one, so any
 * account could read every other account's memories, letters, journal and
 * documents. These cases exist so that can never quietly come back — a
 * forgotten `.where` in one route file should fail here, loudly, rather than
 * in production.
 */

type Resource = {
  path: string;
  create: Record<string, unknown>;
  update?: Record<string, unknown>;
};

const RESOURCES: readonly Resource[] = [
  { path: "memories", create: { title: "Her last birthday" }, update: { title: "changed" } },
  {
    path: "journal",
    create: { title: "Today", content: "private", entryDate: "2026-01-01" },
    update: { title: "changed" },
  },
  {
    path: "letters",
    create: { title: "To you", content: "private", direction: "to_child" },
    update: { title: "changed" },
  },
  {
    path: "creative",
    create: { title: "A poem", content: "private", type: "poem" },
    update: { title: "changed" },
  },
  {
    path: "documents",
    create: { title: "Records", category: "medical", content: "private" },
    update: { title: "changed" },
  },
  { path: "quotes", create: { text: "a quote", type: "quote" } },
  { path: "todos", create: { text: "call the registrar" }, update: { completed: true } },
  { path: "affirmations", create: { text: "survival is enough" } },
  {
    path: "milestones",
    create: { title: "Would have turned 12", milestoneDate: "2026-04-01", type: "birthday" },
  },
  { path: "stories", create: { authorName: "A friend", content: "private" } },
  {
    path: "signs",
    create: { what: "A cardinal on the fence", kind: "cardinal" },
    update: { what: "changed" },
  },
  {
    path: "belongings",
    create: { item: "His leather jacket", status: "kept" },
    update: { status: "given", person: "his brother" },
  },
  {
    path: "gifts",
    create: { fromName: "The Hendersons", kind: "food" },
    update: { thanked: true },
  },
  {
    path: "contacts",
    create: { name: "His football coach", category: "school" },
    update: { told: true },
  },
  {
    path: "obituaries",
    create: { label: "For the paper", fullName: "Sam" },
    update: { label: "changed" },
  },
  {
    path: "memorial-choices",
    create: { category: "song", title: "The one he played constantly" },
    update: { status: "chosen" },
  },
];

afterAll(closeDatabase);

describe("tenant isolation", () => {
  useCleanDatabase();

  for (const resource of RESOURCES) {
    describe(`/${resource.path}`, () => {
      it("is unreachable without a session", async () => {
        await request(app).get(`/api/${resource.path}`).expect(401);
        await request(app)
          .post(`/api/${resource.path}`)
          .send(resource.create)
          .expect(401);
      });

      it("never shows one account's rows to another", async () => {
        const alice = await signUp();
        const bob = await signUp();

        await request(app)
          .post(`/api/${resource.path}`)
          .set("Cookie", alice.cookie)
          .send(resource.create)
          .expect(201);

        const bobsList = await request(app)
          .get(`/api/${resource.path}`)
          .set("Cookie", bob.cookie)
          .expect(200);

        expect(bobsList.body).toEqual([]);

        const alicesList = await request(app)
          .get(`/api/${resource.path}`)
          .set("Cookie", alice.cookie)
          .expect(200);

        expect(alicesList.body).toHaveLength(1);
      });

      it("refuses cross-account writes and deletes by id", async () => {
        const alice = await signUp();
        const bob = await signUp();

        const created = await request(app)
          .post(`/api/${resource.path}`)
          .set("Cookie", alice.cookie)
          .send(resource.create)
          .expect(201);

        const id: number = created.body.id;

        if (resource.update) {
          await request(app)
            .put(`/api/${resource.path}/${id}`)
            .set("Cookie", bob.cookie)
            .send(resource.update)
            .expect(404);
        }

        await request(app)
          .delete(`/api/${resource.path}/${id}`)
          .set("Cookie", bob.cookie)
          .expect(404);

        // Alice's row is untouched by any of the above.
        const after = await request(app)
          .get(`/api/${resource.path}`)
          .set("Cookie", alice.cookie)
          .expect(200);

        expect(after.body).toHaveLength(1);
      });

      it("ignores a userId supplied by the client", async () => {
        const alice = await signUp();
        const bob = await signUp();

        const created = await request(app)
          .post(`/api/${resource.path}`)
          .set("Cookie", alice.cookie)
          .send({ ...resource.create, userId: bob.id })
          .expect(201);

        expect(created.body.userId).toBe(alice.id);

        const bobsList = await request(app)
          .get(`/api/${resource.path}`)
          .set("Cookie", bob.cookie)
          .expect(200);

        expect(bobsList.body).toEqual([]);
      });
    });
  }

  describe("the singleton resources", () => {
    for (const path of ["profile", "tribute"] as const) {
      it(`gives each account its own ${path}`, async () => {
        const alice = await signUp();
        const bob = await signUp();

        const field = path === "profile" ? "childName" : "obituary";

        await request(app)
          .put(`/api/${path}`)
          .set("Cookie", alice.cookie)
          .send({ [field]: "Alice's entry" })
          .expect(200);

        await request(app)
          .put(`/api/${path}`)
          .set("Cookie", bob.cookie)
          .send({ [field]: "Bob's entry" })
          .expect(200);

        const alices = await request(app)
          .get(`/api/${path}`)
          .set("Cookie", alice.cookie)
          .expect(200);
        const bobs = await request(app)
          .get(`/api/${path}`)
          .set("Cookie", bob.cookie)
          .expect(200);

        expect(alices.body[field]).toBe("Alice's entry");
        expect(bobs.body[field]).toBe("Bob's entry");
        expect(alices.body.id).not.toBe(bobs.body.id);
      });

      it(`does not leak ${path} to an anonymous request`, async () => {
        await request(app).get(`/api/${path}`).expect(401);
      });
    }
  });
});
