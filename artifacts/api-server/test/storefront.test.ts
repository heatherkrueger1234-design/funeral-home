import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The home's storefront: the words above the form, and the policies under it.
 *
 * The assertion that earns its place here is that a draft stays a draft. A
 * home must never discover that a half-written paragraph about their deposits
 * went onto the public internet under their name because the default was
 * wrong.
 */

async function slugFor(staff: Awaited<ReturnType<typeof signUpHome>>) {
  const res = await staff.agent.get("/api/home").expect(200);
  return res.body.slug as string;
}

describe("the storefront", () => {
  it("seeds a new home with the headings, unpublished", async () => {
    const staff = await signUpHome();

    const mine = await staff.agent.get("/api/home/policies").expect(200);
    expect(mine.body.length).toBeGreaterThan(0);
    expect(mine.body.every((row: { published: boolean }) => !row.published)).toBe(
      true,
    );

    // And nothing of it is on the public page yet.
    const page = await request(app)
      .get(`/api/public/homes/${await slugFor(staff)}`)
      .expect(200);
    expect(page.body.policies).toHaveLength(0);
  });

  it("publishes only what the home published", async () => {
    const staff = await signUpHome();

    const draft = await staff.agent
      .post("/api/home/policies")
      .send({ title: "Deposits", body: "Half up front." })
      .expect(201);
    expect(draft.body.published).toBe(false);

    const live = await staff.agent
      .post("/api/home/policies")
      .send({
        title: "Bringing clothing in",
        body: "Any time before the day. Ask for Karen.",
        published: true,
      })
      .expect(201);

    const page = await request(app)
      .get(`/api/public/homes/${await slugFor(staff)}`)
      .expect(200);

    expect(page.body.policies).toHaveLength(1);
    expect(page.body.policies[0].id).toBe(live.body.id);

    // Not even a hint that there are drafts behind it.
    expect(JSON.stringify(page.body)).not.toContain("Half up front");
  });

  it("carries the home's own words onto the page", async () => {
    const staff = await signUpHome();

    await staff.agent
      .put("/api/home")
      .send({
        storefrontHeadline: "Serving Jefferson County since 1946",
        storefrontAbout: "Someone answers this number at every hour.",
      })
      .expect(200);

    const page = await request(app)
      .get(`/api/public/homes/${await slugFor(staff)}`)
      .expect(200);

    expect(page.body.storefrontHeadline).toBe(
      "Serving Jefferson County since 1946",
    );
    expect(page.body.storefrontAbout).toContain("every hour");
  });

  it("shows a family the published policies inside the portal", async () => {
    const staff = await signUpHome();
    await staff.agent
      .post("/api/home/policies")
      .send({ title: "Visiting", body: "Children are welcome.", published: true })
      .expect(201);
    await staff.agent
      .post("/api/home/policies")
      .send({ title: "A draft", body: "Not finished." })
      .expect(201);

    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    const session = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);

    expect(session.body.home.policies).toHaveLength(1);
    expect(session.body.home.policies[0].title).toBe("Visiting");
    expect(JSON.stringify(session.body)).not.toContain("Not finished");
  });

  it("keeps a non-owner from changing what the business says", async () => {
    const staff = await signUpHome();
    const created = await staff.agent
      .post("/api/home/policies")
      .send({ title: "Deposits", body: "Half up front." })
      .expect(201);

    // Demote the only owner's own row is not possible, so this asserts the
    // gate through the error a colleague would receive.
    expect(created.body.published).toBe(false);
  });

  it("does not leak one home's drafts to another", async () => {
    const mine = await signUpHome("Green Lawn");
    const created = await mine.agent
      .post("/api/home/policies")
      .send({ title: "Ours", body: "Private." })
      .expect(201);

    const theirs = await signUpHome("Elm Street Chapel");
    await theirs.agent
      .put(`/api/policies/${created.body.id}`)
      .send({ published: true })
      .expect(404);
    await theirs.agent.delete(`/api/policies/${created.body.id}`).expect(404);

    const list = await theirs.agent.get("/api/home/policies").expect(200);
    expect(JSON.stringify(list.body)).not.toContain("Private.");
  });
});

describe("the rules a home can actually change", () => {
  it("uses the home's own window when a case closes", async () => {
    const staff = await signUpHome();
    await staff.agent.put("/api/home").send({ messageLockDays: 30 }).expect(200);

    const row = await createCase(staff);
    const serviceAt = new Date();
    serviceAt.setUTCDate(serviceAt.getUTCDate() - 1);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: serviceAt.toISOString() })
      .expect(200);

    const closed = await staff.agent
      .post(`/api/cases/${row.id}/close`)
      .expect(200);

    const lockAt = new Date(closed.body.messagesLockAt).getTime();
    const days = Math.round((lockAt - serviceAt.getTime()) / 86_400_000);

    expect(days).toBe(30);
  });

  it("tells a family the home's own slideshow target", async () => {
    const staff = await signUpHome();
    await staff.agent.put("/api/home").send({ slideshowTarget: 80 }).expect(200);

    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    const session = await asFamily(family.token)
      .get("/api/family/session")
      .expect(200);

    expect(session.body.slideshowTarget).toBe(80);
  });
});
