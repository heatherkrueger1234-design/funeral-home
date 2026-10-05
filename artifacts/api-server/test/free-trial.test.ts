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

  it("asks Stripe for the same trial, with no card, once Stripe is live", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_x";
    process.env["STRIPE_PRICE_ID"] = "price_base";
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        bodies.push(String(init?.body ?? ""));
        const payload = String(url).endsWith("/customers")
          ? { id: "cus_1" }
          : { url: "https://checkout.stripe.test/s" };
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );

    const staff = await signUpHome();
    const res = await staff.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(200);

    expect(res.body.url).toBe("https://checkout.stripe.test/s");
    const checkout = new URLSearchParams(bodies.at(-1));
    expect(checkout.get("subscription_data[trial_period_days]")).toBe("30");
    expect(checkout.get("payment_method_collection")).toBe("if_required");
  });

  it("offers annual billing at the annual price, and says so when it is not set up", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_x";
    process.env["STRIPE_PRICE_ID"] = "price_base";
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        bodies.push(String(init?.body ?? ""));
        const payload = String(url).endsWith("/customers")
          ? { id: "cus_1" }
          : { url: "https://checkout.stripe.test/s" };
        return new Response(JSON.stringify(payload), { status: 200 });
      }),
    );
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
    const checkout = new URLSearchParams(bodies.at(-1));
    expect(checkout.get("line_items[0][price]")).toBe("price_annual");
    expect(checkout.get("subscription_data[trial_period_days]")).toBe("30");
    delete process.env["STRIPE_PRICE_ID_ANNUAL"];
  });
});
