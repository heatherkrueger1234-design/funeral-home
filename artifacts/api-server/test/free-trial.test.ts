import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, funeralHomesTable } from "@workspace/db";
import { signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Every subscribe button starts the free trial when card billing is not
 * live, so nothing a home does waits on Stripe.
 */
describe("the free trial behind every subscribe button", () => {
  afterEach(() => {
    delete process.env["FREE_TRIAL_DAYS"];
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_PRICE_ID"];
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a 30-day trial with no card, and reopens new cases", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const before = await staff.agent.get("/api/billing").expect(200);
    expect(before.body.trialEnded).toBe(true);
    expect(before.body.canOpenCases).toBe(false);
    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Not", decedentLastName: "Yet" })
      .expect(402);

    const started = await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);
    expect(started.body.url).toBeNull();
    expect(started.body.trialStarted).toBe(true);
    expect(started.body.trialDaysLeft).toBe(30);

    const after = await staff.agent.get("/api/billing").expect(200);
    expect(after.body.trialEnded).toBe(false);
    expect(after.body.canOpenCases).toBe(true);
    // Full features during the trial, aftercare included.
    expect(after.body.addOns.every((a: { included: boolean }) => a.included)).toBe(true);

    await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Hale" })
      .expect(201);
  });

  it("gives a home whose subscription ended a trial of its own, not Stripe's", async () => {
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_ended" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);

    // Left pointing at the old subscription, this trial looked like one
    // Stripe was holding: no reminders before it ended, and no end on time.
    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    expect(home!.subscriptionStatus).toBe("trial");
    expect(home!.stripeSubscriptionId).toBeNull();
    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.hasSubscription).toBe(false);
  });

  it("never shortens a trial already running", async () => {
    const staff = await signUpHome();
    const long = new Date(Date.now() + 60 * DAY);
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: long })
      .where(eq(funeralHomesTable.id, staff.homeId));

    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, staff.homeId));
    expect(home!.trialEndsAt!.getTime()).toBe(long.getTime());
  });

  it("follows FREE_TRIAL_DAYS, and 0 switches it off", async () => {
    process.env["FREE_TRIAL_DAYS"] = "14";
    const staff = await signUpHome();
    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.freeTrialDays).toBe(14);
    expect(billing.body.trialDaysLeft).toBe(14);

    process.env["FREE_TRIAL_DAYS"] = "0";
    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(400);
  });

  it("still starts the no-card trial when the key is set but the price is blank", async () => {
    // What docker-compose hands the API before stripe-setup has been run:
    // every setting is passed through, so an unset price arrives empty.
    process.env["STRIPE_SECRET_KEY"] = "sk_test_x";
    process.env["STRIPE_PRICE_ID"] = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "No such price: ''" } }), { status: 400 })),
    );

    const staff = await signUpHome();
    const started = await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);
    expect(started.body.url).toBeNull();
    expect(started.body.trialStarted).toBe(true);
  });

  /** Stripe, for checkout: a customer, and a checkout page's address. */
  function stripeCheckout() {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_PRICE_ID", "price_base");
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        bodies.push(new URLSearchParams(String(init?.body ?? "")));
        const payload = String(url).endsWith("/customers")
          ? { id: "cus_1" }
          : { url: "https://checkout.stripe.test/s" };
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
    return bodies;
  }

  async function checkout(staff: Awaited<ReturnType<typeof signUpHome>>, status = 200) {
    return staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(status);
  }

  async function homeRow(homeId: number) {
    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, homeId));
    return home!;
  }

  it("gives a home that subscribes during its trial the days it has left, and takes a card", async () => {
    const bodies = stripeCheckout();
    const staff = await signUpHome();
    const endsAt = new Date(Date.now() + 10 * DAY);
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: endsAt })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(new Date(billing.body.checkoutTrialEndsAt).getTime()).toBe(endsAt.getTime());

    const res = await checkout(staff);
    expect(res.body.url).toBe("https://checkout.stripe.test/s");

    /*
     * The days that are left, not thirty more. A fresh thirty from every
     * subscribe button added a month to a trial on its last day, and
     * another to a home that cancelled and subscribed again, as often as it
     * liked.
     */
    const sent = bodies.at(-1)!;
    expect(sent.get("subscription_data[trial_end]")).toBe(
      String(Math.floor(endsAt.getTime() / 1000)),
    );
    expect(sent.get("subscription_data[trial_period_days]")).toBeNull();
    // A card, so the subscription starts by itself when the trial ends.
    // Without one, Stripe cancelled it then, and the home had subscribed to
    // nothing.
    expect(sent.get("payment_method_collection")).toBeNull();
    expect(
      sent.get("subscription_data[trial_settings][end_behavior][missing_payment_method]"),
    ).toBe("cancel");
  });

  it("rounds a trial in its last two days up to the shortest Stripe will hold", async () => {
    const bodies = stripeCheckout();
    const staff = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() + DAY / 2) })
      .where(eq(funeralHomesTable.id, staff.homeId));

    await checkout(staff);

    // Stripe refuses a checkout trial ending under 48 hours away.
    const trialEnd = Number(bodies.at(-1)!.get("subscription_data[trial_end]")) * 1000;
    expect(trialEnd - Date.now()).toBeGreaterThan(48 * 60 * 60 * 1000);
    expect(trialEnd - Date.now()).toBeLessThan(49 * 60 * 60 * 1000);
  });

  it("charges from the start once the trial is over, or after a subscription has ended", async () => {
    const bodies = stripeCheckout();
    const over = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() - DAY) })
      .where(eq(funeralHomesTable.id, over.homeId));
    const ended = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_ended" })
      .where(eq(funeralHomesTable.id, ended.homeId));

    for (const staff of [over, ended]) {
      const billing = await staff.agent.get("/api/billing").expect(200);
      expect(billing.body.checkoutTrialEndsAt).toBeNull();

      await checkout(staff);
      const sent = bodies.at(-1)!;
      expect(sent.get("subscription_data[trial_end]")).toBeNull();
      expect(sent.get("subscription_data[trial_period_days]")).toBeNull();
    }
  });

  it("refuses a second subscription while one is running", async () => {
    stripeCheckout();
    const paying = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active", stripeSubscriptionId: "sub_paying" })
      .where(eq(funeralHomesTable.id, paying.homeId));
    const held = await signUpHome();
    await db
      .update(funeralHomesTable)
      .set({ stripeSubscriptionId: "sub_trialing" })
      .where(eq(funeralHomesTable.id, held.homeId));

    // Two subscriptions is two bills, and the second is found by the
    // home's bookkeeper, not by us.
    for (const staff of [paying, held]) {
      const refused = await checkout(staff, 409);
      expect(refused.body.error).toMatch(/already/i);
    }
    expect((await homeRow(paying.homeId)).stripeSubscriptionId).toBe("sub_paying");
  });

  it("offers annual billing at the annual price, and says so when it is not set up", async () => {
    const bodies = stripeCheckout();
    const staff = await signUpHome();

    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings", interval: "year" })
      .expect(400);

    process.env["STRIPE_PRICE_ID_ANNUAL"] = "price_annual";
    await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings", interval: "year" })
      .expect(200);
    const sent = bodies.at(-1)!;
    expect(sent.get("line_items[0][price]")).toBe("price_annual");
    // The same days left as monthly: the trial is the home's, not the plan's.
    expect(sent.get("subscription_data[trial_end]")).not.toBeNull();
    delete process.env["STRIPE_PRICE_ID_ANNUAL"];
  });
});
