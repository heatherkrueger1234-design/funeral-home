import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import app from "../src/app";
import { db, billableCasesTable, funeralHomesTable } from "@workspace/db";
import { createCase, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env["STRIPE_WEBHOOK_SECRET"];
});

/** Sign a Stripe event body the way Stripe actually does, for test use only. */
function signedWebhook(secret: string, body: Record<string, unknown>) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return {
    payload,
    header: `t=${timestamp},v1=${signature}`,
  };
}

function subscriptionEvent(
  type: string,
  homeId: number,
  status: string,
  createdAt: number,
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    created: createdAt,
    data: {
      object: {
        id: "sub_test",
        status,
        metadata: { funeralHomeId: String(homeId) },
      },
    },
  };
}

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

  it("does not cut off a home while Stripe turns its trial into a subscription", async () => {
    const staff = await signUpHome();
    // Subscribed during the trial; Stripe holds the trial and ends it, and
    // says within minutes how it ended.
    await db
      .update(funeralHomesTable)
      .set({ stripeSubscriptionId: "sub_held", trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const waiting = await staff.agent.get("/api/billing").expect(200);
    expect(waiting.body.trialEnded).toBe(false);
    expect(waiting.body.canOpenCases).toBe(true);
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Opened", decedentLastName: "Anyway" })
      .expect(201);

    // Not for ever: past the days Stripe goes on retrying a webhook, its
    // silence is an answer.
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() - 4 * DAY) })
      .where(eq(funeralHomesTable.id, staff.homeId));
    const silent = await staff.agent.get("/api/billing").expect(200);
    expect(silent.body.trialEnded).toBe(true);
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Not", decedentLastName: "Now" })
      .expect(402);
  });

  it("offers a home whose subscription ended a new one, not the old one's portal", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_ended" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.hasSubscription).toBe(false);
  });

  it("says plainly when the deployment has no Stripe keys", async () => {
    const staff = await signUpHome();

    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.billingConfigured).toBe(false);

    // Never a broken checkout URL: the button starts the no-card trial here
    // instead, and refuses only when the trial is switched off.
    const started = await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);
    expect(started.body.url).toBeNull();
    expect(started.body.trialStarted).toBe(true);

    process.env["FREE_TRIAL_DAYS"] = "0";
    try {
      await staff.agent
        .post("/api/billing/checkout")
        .send({ returnUrl: "https://example.com/settings" })
        .expect(400);
    } finally {
      delete process.env["FREE_TRIAL_DAYS"];
    }
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

  /**
   * A real signature, computed the way Stripe computes one, over the exact
   * bytes sent. This is the case the "refuses anything it cannot verify"
   * test above cannot catch: a webhook route reached *after* the global JSON
   * parser has already consumed the request stream turns `express.raw()`
   * into a no-op, so `req.body` is a parsed object rather than the original
   * buffer — every real signature then fails to verify too, not just bad
   * ones, and a home that actually pays never gets marked as paying.
   */
  it("accepts a correctly signed event and applies it", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
    const staff = await signUpHome();

    const { payload, header } = signedWebhook(
      "whsec_test_secret",
      subscriptionEvent(
        "customer.subscription.updated",
        staff.homeId,
        "active",
        Math.floor(Date.now() / 1000),
      ),
    );

    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(payload)
      .expect(200);

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    expect(home!.subscriptionStatus).toBe("active");
  });

  it("accepts an event signed with the old and the new secret while one is rolled", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_new_secret";
    const staff = await signUpHome();

    const { payload, header } = signedWebhook(
      "whsec_new_secret",
      subscriptionEvent(
        "customer.subscription.updated",
        staff.homeId,
        "active",
        Math.floor(Date.now() / 1000),
      ),
    );
    // Stripe adds the old secret's signature too, and promises no order.
    const timestamp = header.split(",")[0]!.slice(2);
    const old = createHmac("sha256", "whsec_old_secret")
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", `${header},v1=${old}`)
      .send(payload)
      .expect(200);

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    expect(home!.subscriptionStatus).toBe("active");
  });

  it("does not let an event delivered out of order move the status backwards", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
    const staff = await signUpHome();
    const now = Math.floor(Date.now() / 1000);

    // The cancellation was created *after* the stale update, but Stripe
    // delivers it first.
    const deleted = signedWebhook(
      "whsec_test_secret",
      subscriptionEvent(
        "customer.subscription.deleted",
        staff.homeId,
        "canceled",
        now,
      ),
    );
    const staleUpdate = signedWebhook(
      "whsec_test_secret",
      subscriptionEvent(
        "customer.subscription.updated",
        staff.homeId,
        "active",
        now - 60,
      ),
    );

    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", deleted.header)
      .send(deleted.payload)
      .expect(200);

    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", staleUpdate.header)
      .send(staleUpdate.payload)
      .expect(200);

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    expect(home!.subscriptionStatus).toBe("canceled");
  });

  it("leaves a trial alone while the first payment is still going through", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
    const staff = await signUpHome();
    const before = await homeRow(staff.homeId);

    // What checkout creates when a card needs the bank's say-so: a
    // subscription that exists, and has not been paid for yet.
    const { payload, header } = signedWebhook(
      "whsec_test_secret",
      subscriptionEvent(
        "customer.subscription.created",
        staff.homeId,
        "incomplete",
        Math.floor(Date.now() / 1000),
      ),
    );
    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(payload)
      .expect(200);

    const after = await homeRow(staff.homeId);
    expect(after.subscriptionStatus).toBe("trial");
    expect(after.trialEndsAt).toEqual(before.trialEndsAt);
    expect(after.stripeSubscriptionId).toBeNull();
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Still", decedentLastName: "Open" })
      .expect(201);
  });

  it("does not let an old subscription's end cancel the one that replaced it", async () => {
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active", stripeSubscriptionId: "sub_new" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const { payload, header } = signedWebhook("whsec_test_secret", {
      id: "evt_old_end",
      type: "customer.subscription.deleted",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: "sub_old",
          status: "canceled",
          metadata: { funeralHomeId: String(staff.homeId) },
        },
      },
    });
    await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(payload)
      .expect(200);

    const home = await homeRow(staff.homeId);
    expect(home.subscriptionStatus).toBe("active");
    expect(home.stripeSubscriptionId).toBe("sub_new");
  });
});

async function homeRow(homeId: number) {
  const [home] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId));
  return home!;
}

/**
 * With an API key, the webhook asks Stripe what the subscription is now
 * rather than believing the event, because the event is only what it was
 * when Stripe queued it, and Stripe promises nothing about the order events
 * arrive in. Two events stamped with the same second -- a subscription
 * created unpaid and paid a moment later -- cannot be ordered by their
 * timestamps at all.
 */
describe("the Stripe webhook, asking Stripe", () => {
  const SECRET = "whsec_test_secret";

  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_notreal");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  type Subscription = {
    id: string;
    status: string;
    customer: string;
    metadata: { funeralHomeId: string };
    trial_end?: number;
    items?: {
      data: Array<{ id: string; current_period_end?: number; price?: { id: string } }>;
    };
  };

  /**
   * Stripe, as much of it as the webhook uses: one subscription by id, and
   * a customer's subscriptions that have not been cancelled.
   */
  function stripeHas(subscriptions: Subscription[]) {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const { pathname, searchParams } = new URL(url);
      asked.push(pathname);
      if (pathname === "/v1/subscriptions") {
        return Response.json({
          object: "list",
          data: subscriptions.filter(
            (row) =>
              row.customer === searchParams.get("customer") &&
              row.status !== "canceled",
          ),
        });
      }
      const id = decodeURIComponent(pathname.slice("/v1/subscriptions/".length));
      const found = subscriptions.find((row) => row.id === id);
      return found
        ? Response.json(found)
        : Response.json({ error: { message: "No such subscription" } }, { status: 404 });
    });
    return asked;
  }

  function deliver(type: string, object: Subscription, created = Math.floor(Date.now() / 1000)) {
    const { payload, header } = signedWebhook(SECRET, {
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type,
      created,
      data: { object },
    });
    return request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", header)
      .send(payload);
  }

  function subscriptionOf(homeId: number, id: string, status: string): Subscription {
    return {
      id,
      status,
      customer: `cus_${homeId}`,
      metadata: { funeralHomeId: String(homeId) },
    };
  }

  it("applies what Stripe says now, whichever of two same-second events lands first", async () => {
    const second = Math.floor(Date.now() / 1000);

    for (const order of [
      ["created", "updated"],
      ["updated", "created"],
    ] as const) {
      const staff = await signUpHome();
      stripeHas([subscriptionOf(staff.homeId, "sub_paid", "active")]);

      // Created unpaid, paid a moment later, both stamped with one second.
      const sent = { created: "incomplete", updated: "active" };
      for (const kind of order) {
        await deliver(
          `customer.subscription.${kind}`,
          subscriptionOf(staff.homeId, "sub_paid", sent[kind]),
          second,
        ).expect(200);
      }

      const home = await homeRow(staff.homeId);
      expect(home.subscriptionStatus, order.join(" then ")).toBe("active");
      expect(home.stripeSubscriptionId).toBe("sub_paid");
    }
  });

  it("leaves a trial alone while Stripe still waits on the first payment", async () => {
    const staff = await signUpHome();
    const before = await homeRow(staff.homeId);
    stripeHas([subscriptionOf(staff.homeId, "sub_waiting", "incomplete")]);

    await deliver(
      "customer.subscription.created",
      subscriptionOf(staff.homeId, "sub_waiting", "incomplete"),
    ).expect(200);

    const after = await homeRow(staff.homeId);
    expect(after.subscriptionStatus).toBe("trial");
    expect(after.trialEndsAt).toEqual(before.trialEndsAt);
    expect(after.stripeSubscriptionId).toBeNull();
  });

  it("does not let an old subscription's end cancel the one that replaced it", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "active",
        stripeCustomerId: `cus_${staff.homeId}`,
        stripeSubscriptionId: "sub_new",
      })
      .where(eq(funeralHomesTable.id, staff.homeId));
    stripeHas([
      subscriptionOf(staff.homeId, "sub_old", "canceled"),
      subscriptionOf(staff.homeId, "sub_new", "active"),
    ]);

    await deliver(
      "customer.subscription.deleted",
      subscriptionOf(staff.homeId, "sub_old", "canceled"),
    ).expect(200);

    const home = await homeRow(staff.homeId);
    expect(home.subscriptionStatus).toBe("active");
    expect(home.stripeSubscriptionId).toBe("sub_new");
  });

  it("moves a home onto its other subscription when the one it was on ends", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "active",
        stripeCustomerId: `cus_${staff.homeId}`,
        stripeSubscriptionId: "sub_second",
      })
      .where(eq(funeralHomesTable.id, staff.homeId));
    // Two checkouts finished in two tabs, and the director cancelled the
    // newer one. They are still paying for the first.
    stripeHas([
      subscriptionOf(staff.homeId, "sub_second", "canceled"),
      subscriptionOf(staff.homeId, "sub_first", "active"),
    ]);

    await deliver(
      "customer.subscription.deleted",
      subscriptionOf(staff.homeId, "sub_second", "canceled"),
    ).expect(200);

    const home = await homeRow(staff.homeId);
    expect(home.subscriptionStatus).toBe("active");
    expect(home.stripeSubscriptionId).toBe("sub_first");
  });

  it("cancels a home whose only subscription has ended", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "active",
        stripeCustomerId: `cus_${staff.homeId}`,
        stripeSubscriptionId: "sub_only",
      })
      .where(eq(funeralHomesTable.id, staff.homeId));
    stripeHas([subscriptionOf(staff.homeId, "sub_only", "canceled")]);

    await deliver(
      "customer.subscription.deleted",
      subscriptionOf(staff.homeId, "sub_only", "canceled"),
    ).expect(200);

    expect((await homeRow(staff.homeId)).subscriptionStatus).toBe("canceled");
  });

  it("keeps a home that subscribed during its trial on a trial, until Stripe's ends", async () => {
    const staff = await signUpHome();
    const trialEnd = Math.floor((Date.now() + 20 * DAY) / 1000);
    const held = { ...subscriptionOf(staff.homeId, "sub_held", "trialing"), trial_end: trialEnd };
    stripeHas([held]);

    await deliver("customer.subscription.created", held).expect(200);

    // Not "active, renewing": nothing has been paid, and nothing will be
    // until the free days are over.
    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.subscriptionStatus).toBe("trial");
    expect(new Date(billing.body.trialEndsAt).getTime()).toBe(trialEnd * 1000);
    expect(billing.body.trialDaysLeft).toBe(20);
    expect(billing.body.trialEnded).toBe(false);
    expect(billing.body.hasSubscription).toBe(true);

    // And a funeral in those days is a trial funeral, counted and waived,
    // as the price list promises.
    const row = await createCase(staff);
    const [counted] = await db
      .select()
      .from(billableCasesTable)
      .where(eq(billableCasesTable.caseId, row.id));
    expect(counted!.waivedReason).toBe("trial");
  });

  it("finds the renewal date where newer Stripe API versions keep it", async () => {
    const staff = await signUpHome();
    const renews = Math.floor((Date.now() + 30 * DAY) / 1000);
    // Since the 2025-03-31 API version the period is on each item, not on
    // the subscription, and an account opened now gets that version.
    const paid = {
      ...subscriptionOf(staff.homeId, "sub_basil", "active"),
      items: { data: [{ id: "si_1", current_period_end: renews, price: { id: "price_base" } }] },
    };
    stripeHas([paid]);

    await deliver("customer.subscription.updated", paid).expect(200);

    const home = await homeRow(staff.homeId);
    expect(home.currentPeriodEndsAt?.getTime()).toBe(renews * 1000);
  });

  it("asks Stripe to send the event again when Stripe cannot be reached", async () => {
    const staff = await signUpHome();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });

    // Anything but a 2xx and Stripe retries, for days. A 200 here would
    // have been the last anyone heard of this payment.
    await deliver(
      "customer.subscription.updated",
      subscriptionOf(staff.homeId, "sub_unheard", "active"),
    ).expect(503);

    const home = await homeRow(staff.homeId);
    expect(home.subscriptionStatus).toBe("trial");
    expect(home.stripeSubscriptionId).toBeNull();
  });

  it("takes two deliveries for one customer in turn, so a slow answer cannot land last", async () => {
    const staff = await signUpHome();
    const subscription = subscriptionOf(staff.homeId, "sub_turns", "active");
    let truth = "active";
    let answered = 0;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));

    vi.stubGlobal("fetch", async (url: string) => {
      if (new URL(url).pathname === "/v1/subscriptions") {
        return Response.json({ object: "list", data: [] });
      }
      // What Stripe said is fixed when it said it; the first answer is
      // then slow to arrive.
      const status = truth;
      answered += 1;
      if (answered === 1) await firstHeld;
      return Response.json({ ...subscription, status });
    });

    const first = deliver("customer.subscription.updated", subscription).then((res) => res);
    await vi.waitFor(() => expect(answered).toBe(1));

    // The director cancels while the first answer is still on its way.
    truth = "canceled";
    const second = deliver(
      "customer.subscription.deleted",
      { ...subscription, status: "canceled" },
    ).then((res) => res);

    // The second delivery waits its turn rather than asking Stripe now.
    await vi.waitFor(async () => {
      const [waiting] = (
        await db.execute(
          sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
        )
      ).rows as Array<{ n: number }>;
      expect(waiting!.n).toBe(1);
    });
    releaseFirst();

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await homeRow(staff.homeId)).subscriptionStatus).toBe("canceled");
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
