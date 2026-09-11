import { describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { db, funeralHomesTable } from "@workspace/db";
import { createCase, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Billing, and the one thing it is allowed to stop.
 *
 * Most of what is asserted here is what keeps working when money goes wrong,
 * because locking a funeral home out of Thursday's funeral over an expired
 * card would be a disgrace.
 */
describe("trials and subscriptions", () => {
  it("starts a new home on a real, dated trial", async () => {
    const staff = await signUpHome();
    const billing = await staff.agent.get("/api/billing").expect(200);

    expect(billing.body.subscriptionStatus).toBe("trial");
    expect(billing.body.trialEndsAt).not.toBeNull();
    expect(billing.body.trialDaysLeft).toBeGreaterThan(25);
    expect(billing.body.canOpenCases).toBe(true);
  });

  it("stops new cases when the trial runs out, and keeps the old ones", async () => {
    const staff = await signUpHome();
    const existing = await createCase(staff);

    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(funeralHomesTable.id, staff.homeId));

    // No new cases...
    const refused = await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "New", decedentLastName: "Case" })
      .expect(402);
    expect(refused.body.error).toMatch(/trial/i);

    // ...but the family part-way through uploading photographs of their
    // mother does not lose access, and neither does the director.
    await staff.agent.get(`/api/cases/${existing.id}`).expect(200);
    await staff.agent
      .put(`/api/cases/${existing.id}`)
      .send({ serviceLocation: "St Mary's" })
      .expect(200);
    await staff.agent
      .post(`/api/cases/${existing.id}/contacts`)
      .send({ name: "Anne Hale" })
      .expect(201);
  });

  it("keeps working while Stripe chases an expired card", async () => {
    const staff = await signUpHome();

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "past_due", trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(funeralHomesTable.id, staff.homeId));

    // A card that expired is an administrative problem, not a reason to
    // stop a funeral director mid-week.
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Still", decedentLastName: "Working" })
      .expect(201);
  });

  it("stops new cases once a subscription is cancelled", async () => {
    const staff = await signUpHome();

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "No", decedentLastName: "More" })
      .expect(402);
  });

  it("says plainly when the deployment has no Stripe keys", async () => {
    const staff = await signUpHome();

    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.billingConfigured).toBe(false);

    // And refuses rather than producing a broken checkout URL.
    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(400);
  });
});

describe("the Stripe webhook", () => {
  it("refuses anything it cannot verify", async () => {
    // No signature, a bad signature, and a well-formed body with neither.
    await request(app).post("/api/billing/webhook").send({}).expect(400);

    await request(app)
      .post("/api/billing/webhook")
      .set("Stripe-Signature", "t=1,v1=deadbeef")
      .send({ type: "customer.subscription.updated" })
      .expect(400);
  });
});

describe("mounting", () => {
  it("does not let the billing gate leak onto the rest of the API", async () => {
    /*
     * This has now happened twice: a sub-router mounted at the root applies
     * its middleware to every request that passes through it, so one
     * `router.use(requireAuth)` in the middle of a router file quietly put a
     * session gate in front of the whole API. The family surface went down
     * the same way earlier.
     *
     * Asserted from outside rather than by reading the mount order, because
     * the mount order is exactly the thing that looked right both times.
     */
    await request(app).get("/api/healthz").expect(200);

    // The family surface is behind its own gate, not the staff one: a
    // missing link token is a 401, never a redirect to staff sign-in.
    await request(app).get("/api/family/session").expect(401);

    // And a public auth route still takes a body rather than demanding a
    // session first.
    await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-password-here" })
      .expect(401);
  });
});

describe("the setup checklist", () => {
  it("ticks itself off as the work is actually done", async () => {
    const staff = await signUpHome();

    const before = await staff.agent.get("/api/billing").expect(200);
    expect(before.body.onboarding.every((s: { done: boolean }) => !s.done)).toBe(true);

    const row = await createCase(staff);
    await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale" })
      .expect(201);
    await staff.agent
      .put("/api/home")
      .send({ accentColor: "#2b5f55" })
      .expect(200);

    const after = await staff.agent.get("/api/billing").expect(200);
    const done = (key: string) =>
      after.body.onboarding.find((s: { key: string }) => s.key === key).done;

    // A checklist a director has to tick themselves stays unticked while
    // the work gets done anyway.
    expect(done("case")).toBe(true);
    expect(done("family")).toBe(true);
    expect(done("branding")).toBe(true);
    expect(done("hours")).toBe(false);
    expect(after.body.onboardingComplete).toBe(false);
  });

  it("does not record the same step twice", async () => {
    const staff = await signUpHome();

    await createCase(staff, { decedentLastName: "One" });
    await createCase(staff, { decedentLastName: "Two" });
    await createCase(staff, { decedentLastName: "Three" });

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));

    const steps = home!.onboardingDone.split(",").filter(Boolean);
    expect(steps.filter((s) => s === "case")).toHaveLength(1);
  });

  it("can be dismissed and undone by hand", async () => {
    const staff = await signUpHome();

    const dismissed = await staff.agent
      .post("/api/home/onboarding")
      .send({ step: "staff" })
      .expect(200);
    expect(
      dismissed.body.onboarding.find((s: { key: string }) => s.key === "staff").done,
    ).toBe(true);

    const undone = await staff.agent
      .post("/api/home/onboarding")
      .send({ step: "staff", done: false })
      .expect(200);
    expect(
      undone.body.onboarding.find((s: { key: string }) => s.key === "staff").done,
    ).toBe(false);

    await staff.agent
      .post("/api/home/onboarding")
      .send({ step: "not-a-step" })
      .expect(400);
  });
});
