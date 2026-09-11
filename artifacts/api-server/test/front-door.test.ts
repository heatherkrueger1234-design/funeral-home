/**
 * The three ways in, and the one of them that is reachable by anybody.
 *
 * Until this existed the portal had exactly one door: a token texted by a
 * director. These tests are mostly about the two new ones staying closed in
 * the right places — an unauthenticated stranger must be able to ask, and
 * must not be able to reach, create, or learn anything.
 */
import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import { signUpHome } from "./helpers";
import { publicRateLimit } from "../src/middleware/rate-limit";
import { db, funeralHomesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function slugOf(homeId: number): Promise<string> {
  const [home] = await db
    .select({ slug: funeralHomesTable.slug })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId))
    .limit(1);
  return home!.slug;
}

function atNeed(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    homeSlug: slug,
    kind: "at_need",
    requesterName: "Marie Vance",
    requesterPhone: "+15555550142",
    relationship: "Daughter",
    subjectFirstName: "Eleanor",
    subjectLastName: "Vance",
    ...overrides,
  };
}

function preNeed(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    homeSlug: slug,
    kind: "pre_need",
    requesterName: "Harold Finch",
    requesterEmail: "harold@example.com",
    subjectFirstName: "Harold",
    subjectLastName: "Finch",
    ...overrides,
  };
}

beforeEach(() => {
  publicRateLimit.reset();
});

describe("the home's public page", () => {
  it("gives a stranger enough to know it is the right home, and nothing else", async () => {
    const staff = await signUpHome("Riverside Funeral Home");
    const slug = await slugOf(staff.homeId);

    const res = await request(app).get(`/api/public/homes/${slug}`).expect(200);

    expect(res.body.name).toBe("Riverside Funeral Home");
    expect(res.body.intakeEnabled).toBe(true);

    // Nothing about the account, ever. A competitor can read this page.
    expect(res.body).not.toHaveProperty("subscriptionStatus");
    expect(res.body).not.toHaveProperty("stripeCustomerId");
    expect(res.body).not.toHaveProperty("trialEndsAt");
    expect(res.body).not.toHaveProperty("id");
  });

  it("is case-insensitive, because people type URLs the way they speak", async () => {
    const staff = await signUpHome("Willow Grove");
    const slug = await slugOf(staff.homeId);

    await request(app)
      .get(`/api/public/homes/${slug.toUpperCase()}`)
      .expect(200);
  });

  it("still answers for a home that has stopped paying, but closes the form", async () => {
    const staff = await signUpHome("Oakwood Chapel");
    const slug = await slugOf(staff.homeId);

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    // The page must still render: this is a real business with a real
    // telephone, and a family who reached it needs that number. What must not
    // happen is details of a death being collected into a dead account.
    const res = await request(app).get(`/api/public/homes/${slug}`).expect(200);
    expect(res.body.intakeEnabled).toBe(false);

    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(404);
  });
});

describe("asking a home to open a file", () => {
  it("takes an at-need request without any credential at all", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    const res = await request(app)
      .post("/api/public/intake")
      .send(atNeed(slug))
      .expect(202);

    expect(res.body.received).toBe(true);
    expect(res.body.kind).toBe("at_need");

    // The receipt says nothing about the home's queue, and nothing about
    // whether this person is already known to them.
    expect(res.body).not.toHaveProperty("id");
    expect(res.body).not.toHaveProperty("caseId");
  });

  it("does not create a case — a stranger cannot write into a director's list", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);

    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.body).toHaveLength(0);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].status).toBe("pending");
  });

  it("refuses a date of death on a pre-need request", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    // Being lenient here produces a file that says a living person died.
    await request(app)
      .post("/api/public/intake")
      .send(preNeed(slug, { dateOfDeath: new Date().toISOString() }))
      .expect(400);
  });

  it("never puts the word 'self' in a pre-need requester's mouth", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    await request(app)
      .post("/api/public/intake")
      .send(preNeed(slug, { relationship: "Self" }))
      .expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    expect(queue.body[0].relationship).toBeNull();
  });

  it("404s an unknown home without saying whether it ever existed", async () => {
    await request(app)
      .post("/api/public/intake")
      .send(atNeed("no-such-funeral-home"))
      .expect(404);
  });

  it("never shows one home's queue to another", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");
    const slugA = await slugOf(a.homeId);

    await request(app).post("/api/public/intake").send(atNeed(slugA)).expect(202);

    expect((await a.agent.get("/api/intake-requests").expect(200)).body).toHaveLength(1);
    expect((await b.agent.get("/api/intake-requests").expect(200)).body).toHaveLength(0);
  });

  it("keeps the submitter's address out of what the director sees", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    expect(queue.body[0]).not.toHaveProperty("submittedFromIp");
  });
});

describe("the queue itself is staff-only", () => {
  it("refuses an unauthenticated caller", async () => {
    await request(app).get("/api/intake-requests").expect(401);
  });

  it("refuses accepting without a session", async () => {
    await request(app).post("/api/intake-requests/1/accept").expect(401);
  });
});

describe("accepting a request", () => {
  it("opens an at-need case and hands back a link to send", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const res = await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/accept`)
      .expect(201);

    expect(res.body.kind).toBe("at_need");
    expect(res.body.decedentLastName).toBe("Vance");
    // A case with a family member on it is live, not an intake stub.
    expect(res.body.status).toBe("active");
    expect(res.body.familyLink).toContain("/f/");

    // And the person who asked is already on it, so nobody re-types a name.
    const contacts = await staff.agent
      .get(`/api/cases/${res.body.id}/contacts`)
      .expect(200);
    expect(contacts.body).toHaveLength(1);
    expect(contacts.body[0].name).toBe("Marie Vance");
  });

  it("opens a pre-need file for someone who is still alive", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app).post("/api/public/intake").send(preNeed(slug)).expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const res = await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/accept`)
      .expect(201);

    expect(res.body.kind).toBe("pre_need");
    expect(res.body.dateOfDeath).toBeNull();
  });

  it("cannot be accepted twice, however fast the second director clicks", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const id = queue.body[0].id;

    await staff.agent.post(`/api/intake-requests/${id}/accept`).expect(201);
    // The cost of getting this wrong is two cases for one death.
    await staff.agent.post(`/api/intake-requests/${id}/accept`).expect(409);

    expect((await staff.agent.get("/api/cases").expect(200)).body).toHaveLength(1);
  });

  it("refuses a request belonging to another home", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");
    const slugA = await slugOf(a.homeId);
    await request(app).post("/api/public/intake").send(atNeed(slugA)).expect(202);

    const queue = await a.agent.get("/api/intake-requests").expect(200);
    await b.agent.post(`/api/intake-requests/${queue.body[0].id}/accept`).expect(404);
  });

  it("declines without telling the family anything automatically", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const res = await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/decline`)
      .expect(200);

    expect(res.body.status).toBe("declined");
    expect((await staff.agent.get("/api/cases").expect(200)).body).toHaveLength(0);
    await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/accept`)
      .expect(409);
  });
});

describe("a pre-need file does not behave like a bereavement", () => {
  it("builds no funeral timeline for someone who is perfectly well", async () => {
    const staff = await signUpHome();

    // A home may set a standard schedule; a pre-need file must not get one.
    const res = await staff.agent
      .post("/api/cases")
      .send({
        kind: "pre_need",
        decedentFirstName: "Harold",
        decedentLastName: "Finch",
        serviceAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .expect(201);

    const deadlines = await staff.agent
      .get(`/api/cases/${res.body.id}/deadlines`)
      .expect(200);

    expect(deadlines.body).toHaveLength(0);
  });

  it("defaults to at-need, so nothing that existed before changes", async () => {
    const staff = await signUpHome();
    const res = await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Hale" })
      .expect(201);

    expect(res.body.kind).toBe("at_need");
  });
});

describe("mounting — the bug this codebase keeps making", () => {
  /*
   * Three times now. The family gate, then the billing gate, now the public
   * rate limiter: `router.use(middleware, subRouter)` with no path prefix
   * runs that middleware for *every* request in the application, not only the
   * sub-router's. It reads correctly every single time.
   *
   * The first two were caught by a test. This one was caught by fifteen
   * unrelated tests going red at once, because a limiter sized for one
   * grieving person filling in one form was suddenly counting every request a
   * director made.
   *
   * So this asserts the property rather than the instance: the public
   * limiter's budget must be spendable without costing the staff surface
   * anything.
   */
  it("does not let the public limiter leak onto the staff surface", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    // Spend the whole public budget and then some.
    for (let i = 0; i < 40; i++) {
      await request(app).get(`/api/public/homes/${slug}`);
    }

    // A director must not notice. If this 429s, the limiter has leaked.
    await staff.agent.get("/api/cases").expect(200);
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Hale" })
      .expect(201);

    // Nor may it reach the other unauthenticated surfaces, which have their
    // own, differently-sized limiters for different reasons.
    await request(app).get("/api/healthz").expect(200);
    await request(app).get("/api/family/session").expect(401);
  });

  it("does limit the public surface it is actually for", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);

    let sawLimit = false;
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get(`/api/public/homes/${slug}`);
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }

    expect(sawLimit).toBe(true);
  });
});
