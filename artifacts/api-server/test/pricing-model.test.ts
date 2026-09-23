import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  billableCasesTable,
  funeralHomesTable,
  homeGroupsTable,
  aftercareEnrollmentsTable,
  aftercareDeliveriesTable,
  hasAddOn,
} from "@workspace/db";
import { runCaseMetering } from "../src/lib/metering";
import { applySubscription } from "../src/lib/billing";
import { createCase, inviteFamily, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * What the home is charged for, and what the family never is.
 *
 * The per-case charge is the part of the bill that moves, which makes it the
 * part that has to be exactly right: a home billed twice for burying the same
 * person will not accept that it was a rounding error, and they will be
 * correct not to.
 */

/** Put a home onto a real, paying subscription so its cases are billable. */
async function makePaying(homeId: number, extra: Record<string, unknown> = {}) {
  await db
    .update(funeralHomesTable)
    .set({
      subscriptionStatus: "active",
      trialEndsAt: new Date(Date.now() - DAY),
      stripeCustomerId: `cus_test_${homeId}`,
      stripeSubscriptionId: `sub_test_${homeId}`,
      ...extra,
    })
    .where(eq(funeralHomesTable.id, homeId));
}

function billableRows(homeId: number) {
  return db
    .select()
    .from(billableCasesTable)
    .where(eq(billableCasesTable.funeralHomeId, homeId));
}

describe("counting funerals", () => {
  it("counts an at-need case once, and says so in the console", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);

    const row = await createCase(staff);

    const counted = await billableRows(staff.homeId);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.caseId).toBe(row.id);
    expect(counted[0]!.waivedReason).toBeNull();
    expect(counted[0]!.reportedAt).toBeNull();

    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.cases.billableThisMonth).toBe(1);
    // The response says what the number is, because a count that reads like
    // an invoice is how a customer ends up with two answers about what they
    // owe.
    expect(billing.body.cases.note).toMatch(/not a bill/i);
  });

  it("waives what happens during the trial, and records that it waived it", async () => {
    const staff = await signUpHome();
    await createCase(staff);

    const counted = await billableRows(staff.homeId);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.waivedReason).toBe("trial");

    // Visible as a waiver rather than as an absence. "We handled four
    // funerals and you billed us for one" has to be answerable.
    const billing = await staff.agent.get("/api/billing").expect(200);
    expect(billing.body.cases.billableThisMonth).toBe(0);
    expect(billing.body.cases.waivedThisMonth).toBe(1);
  });

  it("does not charge a home for somebody who is still alive", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);

    await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Margaret",
      decedentLastName: "Alive",
    });

    // A pre-need file is somebody writing down what they want. Billing for
    // it is how you teach a home to stop recording them.
    expect(await billableRows(staff.homeId)).toHaveLength(0);
  });

  it("counts a pre-need file on the day it becomes a funeral, and only then", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);

    const row = await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    expect(await billableRows(staff.homeId)).toHaveLength(0);

    await staff.agent
      .post(`/api/cases/${row.id}/at-need`)
      .send({ dateOfDeath: "2026-03-04" })
      .expect(200);

    const counted = await billableRows(staff.homeId);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.caseId).toBe(row.id);
  });

  it("cannot count the same death twice", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);

    const row = await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/at-need`)
      .send({ dateOfDeath: "2026-03-04" })
      .expect(200);
    // The second attempt is refused as a case operation, but the guarantee
    // being tested is the one underneath it: the unique index, not the 409.
    await staff.agent
      .post(`/api/cases/${row.id}/at-need`)
      .send({ dateOfDeath: "2026-03-04" })
      .expect(409);

    expect(await billableRows(staff.homeId)).toHaveLength(1);

    // And directly, in case a future route ever calls the recorder twice.
    await expect(
      db.insert(billableCasesTable).values({
        funeralHomeId: staff.homeId,
        caseId: row.id,
      }),
    ).rejects.toThrow();
  });

  it("keeps the count after the case is erased", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);

    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Margaret Hale", reason: "The family asked." })
      .expect(204);

    /*
     * An accounting record about a funeral we served, holding no name and
     * nothing about the deceased. If erasure reached it, a home could erase
     * its way out of an invoice and, worse, our books would silently stop
     * agreeing with Stripe's.
     */
    const counted = await billableRows(staff.homeId);
    expect(counted).toHaveLength(1);
    expect(counted[0]!.caseId).toBe(row.id);
  });
});

describe("reporting the count to Stripe", () => {
  const realFetch = globalThis.fetch;
  const previous = {
    key: process.env["STRIPE_SECRET_KEY"],
    price: process.env["STRIPE_PRICE_ID_CASE"],
    meter: process.env["STRIPE_CASE_METER_EVENT"],
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of [
      ["STRIPE_SECRET_KEY", previous.key],
      ["STRIPE_PRICE_ID_CASE", previous.price],
      ["STRIPE_CASE_METER_EVENT", previous.meter],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function configureMeter() {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_notreal";
    process.env["STRIPE_PRICE_ID_CASE"] = "price_case";
    process.env["STRIPE_CASE_METER_EVENT"] = "funeral_case";
  }

  it("reports nothing and fails nothing when there is no meter", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId);
    await createCase(staff);

    const result = await runCaseMetering();

    // A flat-subscription deployment is a perfectly good product, not a
    // broken one. Nothing here should page anybody.
    expect(result.due).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.meteringConfigured).toBe(false);
  });

  it("sends one meter event per funeral, keyed so a retry cannot double it", async () => {
    configureMeter();
    const staff = await signUpHome();
    await makePaying(staff.homeId);
    const row = await createCase(staff);

    const sent: Array<Record<string, string>> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      expect(String(url)).toContain("/billing/meter_events");
      return new Response(JSON.stringify({ id: "mbe_1" }), { status: 200 });
    }) as typeof fetch;

    const first = await runCaseMetering();
    expect(first.reported).toBe(1);
    expect(first.failed).toBe(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]!["event_name"]).toBe("funeral_case");
    expect(sent[0]!["payload[value]"]).toBe("1");
    expect(sent[0]!["payload[stripe_customer_id]"]).toBe(
      `cus_test_${staff.homeId}`,
    );
    // The identifier is the second guarantee against double-billing, after
    // the unique index. Stripe deduplicates on it.
    expect(sent[0]!["identifier"]).toBe(`case-${row.id}`);

    // A second run has nothing to say.
    const second = await runCaseMetering();
    expect(second.due).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("treats a duplicate Stripe already has as done, not as a failure", async () => {
    configureMeter();
    const staff = await signUpHome();
    await makePaying(staff.homeId);
    await createCase(staff);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: { message: "A meter event with this identifier already exists." },
        }),
        { status: 400 },
      )) as typeof fetch;

    const result = await runCaseMetering();

    // The charge exists. Retrying for ever against a meter that has already
    // counted it would be the actual bug.
    expect(result.duplicates).toBe(1);
    expect(result.failed).toBe(0);

    const [counted] = await billableRows(staff.homeId);
    expect(counted!.reportedAt).not.toBeNull();
  });

  it("retries a real failure instead of losing the month", async () => {
    configureMeter();
    const staff = await signUpHome();
    await makePaying(staff.homeId);
    await createCase(staff);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Service unavailable" } }), {
        status: 503,
      })) as typeof fetch;

    const failed = await runCaseMetering();
    expect(failed.failed).toBe(1);

    const [afterFailure] = await billableRows(staff.homeId);
    expect(afterFailure!.failedAt).not.toBeNull();
    expect(afterFailure!.failureReason).toMatch(/unavailable/i);

    // Unlike a grief email, an invoice line that failed this morning must
    // absolutely be sent this afternoon.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "mbe_2" }), { status: 200 })) as typeof fetch;

    const retried = await runCaseMetering();
    expect(retried.reported).toBe(1);

    const [afterRetry] = await billableRows(staff.homeId);
    expect(afterRetry!.reportedAt).not.toBeNull();
    expect(afterRetry!.failedAt).toBeNull();
  });

  it("never reports a waived trial case", async () => {
    configureMeter();
    const staff = await signUpHome();
    await createCase(staff);

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(JSON.stringify({ id: "mbe_3" }), { status: 200 });
    }) as typeof fetch;

    const result = await runCaseMetering();
    expect(result.due).toBe(0);
    expect(called).toBe(false);
  });
});

describe("aftercare as something the home buys", () => {
  /** Close a case with a contact on it, and report what aftercare exists. */
  async function closeWithFamily(staff: Awaited<ReturnType<typeof signUpHome>>) {
    const row = await createCase(staff, { serviceAt: "2026-03-10T15:00:00.000Z" });
    await inviteFamily(staff, row.id, { email: "anne@example.com" });
    await staff.agent.post(`/api/cases/${row.id}/close`).send({}).expect(200);

    return db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.caseId, row.id));
  }

  it("is included in the trial, because it is the thing being sold", async () => {
    const staff = await signUpHome();
    expect(await closeWithFamily(staff)).toHaveLength(1);
  });

  it("does not enrol anybody new once it is off the contract", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId, { entitlements: "" });

    expect(await closeWithFamily(staff)).toHaveLength(0);
  });

  it("enrols again when the add-on is on the contract", async () => {
    const staff = await signUpHome();
    await makePaying(staff.homeId, { entitlements: "aftercare" });

    expect(await closeWithFamily(staff)).toHaveLength(1);
  });

  it("keeps sending to a family already enrolled after the home stops paying", async () => {
    const staff = await signUpHome();
    const enrolled = await closeWithFamily(staff);
    expect(enrolled).toHaveLength(1);

    /*
     * The one that matters.
     *
     * Somebody promised this family, in the home's name, that they would
     * hear from them on the anniversary of their mother's death. The home
     * cancelling its subscription is not a reason to break that, and a
     * product that broke it would deserve everything that followed.
     */
    await db
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: "canceled",
        trialEndsAt: new Date(Date.now() - DAY),
        entitlements: "",
      })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const deliveries = await db
      .select()
      .from(aftercareDeliveriesTable)
      .where(eq(aftercareDeliveriesTable.enrollmentId, enrolled[0]!.id));

    // All four check-ins are still scheduled, the anniversary included.
    expect(deliveries.map((d) => d.dayOffset).sort((a, b) => a - b)).toEqual([
      30, 60, 90, 365,
    ]);
    expect(deliveries.every((d) => d.failedAt === null)).toBe(true);
  });

  it("is on during a live trial and off once the trial has expired", () => {
    const base = { entitlements: "" };

    expect(
      hasAddOn({ ...base, subscriptionStatus: "trial", trialEndsAt: null }, "aftercare"),
    ).toBe(true);

    expect(
      hasAddOn(
        {
          ...base,
          subscriptionStatus: "trial",
          trialEndsAt: new Date(Date.now() - DAY),
        },
        "aftercare",
      ),
    ).toBe(false);

    // A home that is past due has bought it and Stripe is chasing the card.
    // That is not a reason to stop somebody's grief check-ins either.
    expect(
      hasAddOn(
        {
          subscriptionStatus: "past_due",
          trialEndsAt: null,
          entitlements: "aftercare",
        },
        "aftercare",
      ),
    ).toBe(true);
  });
});

describe("groups: one contract, many locations", () => {
  async function makeGroup(name = "Rocky Mountain Family Care") {
    const [group] = await db
      .insert(homeGroupsTable)
      .values({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        stripeCustomerId: "cus_group_1",
        trialEndsAt: new Date(Date.now() + 30 * DAY),
      })
      .returning();

    return group!;
  }

  it("writes the group's answer down onto every location", async () => {
    const group = await makeGroup();
    const denver = await signUpHome("Denver Chapel");
    const boulder = await signUpHome("Boulder Chapel");

    await db
      .update(funeralHomesTable)
      .set({ groupId: group.id })
      .where(eq(funeralHomesTable.id, denver.homeId));
    await db
      .update(funeralHomesTable)
      .set({ groupId: group.id })
      .where(eq(funeralHomesTable.id, boulder.homeId));

    const applied = await applySubscription({
      id: "sub_group_1",
      status: "active",
      customer: "cus_group_1",
      current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000),
      items: { data: [{ price: { id: "price_aftercare_test" } }] },
    } as never, new Date());

    expect(applied).toBe(true);

    /*
     * The fan-out is the point. `canOpenCases` reads one row and takes one
     * predicate everywhere in this API; a gate that had to remember to join
     * to a group for some tenants is a gate that will eventually forget.
     */
    for (const homeId of [denver.homeId, boulder.homeId]) {
      const [home] = await db
        .select()
        .from(funeralHomesTable)
        .where(eq(funeralHomesTable.id, homeId));

      expect(home!.subscriptionStatus).toBe("active");
      expect(home!.currentPeriodEndsAt).not.toBeNull();
      // And not the group's Stripe ids: one branch must not be able to open
      // the portal and cancel the contract covering the other thirty-nine.
      expect(home!.stripeSubscriptionId).toBeNull();
      expect(home!.stripeCustomerId).toBeNull();
    }
  });

  it("does not let a stale Stripe event un-cancel forty locations", async () => {
    const group = await makeGroup("Consolidated Care");
    const denver = await signUpHome("Denver Chapel");

    await db
      .update(funeralHomesTable)
      .set({ groupId: group.id })
      .where(eq(funeralHomesTable.id, denver.homeId));

    const cancelledAt = new Date();
    const event = (status: string) =>
      ({
        id: "sub_group_1",
        status,
        customer: "cus_group_1",
        items: { data: [] },
      }) as never;

    await applySubscription(event("canceled"), cancelledAt);

    /*
     * Stripe does not guarantee delivery order, so an `updated` queued
     * before this `deleted` can land after it. On a single home that stale
     * event silently re-activates one account; on a group it re-activates
     * every location under the contract, because the answer is written down
     * onto all of them in one statement.
     */
    const applied = await applySubscription(
      event("active"),
      new Date(cancelledAt.getTime() - 60_000),
    );

    // Handled — Stripe must not be told to retry — but not applied.
    expect(applied).toBe(true);

    const [groupRow] = await db
      .select()
      .from(homeGroupsTable)
      .where(eq(homeGroupsTable.id, group.id));
    expect(groupRow!.subscriptionStatus).toBe("canceled");

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, denver.homeId));
    expect(home!.subscriptionStatus).toBe("canceled");

    // And a genuinely newer event still gets through.
    await applySubscription(
      event("active"),
      new Date(cancelledAt.getTime() + 60_000),
    );

    const [reopened] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, denver.homeId));
    expect(reopened!.subscriptionStatus).toBe("active");
  });

  it("bills a location's funerals to the group", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_notreal";
    process.env["STRIPE_PRICE_ID_CASE"] = "price_case";
    process.env["STRIPE_CASE_METER_EVENT"] = "funeral_case";
    const realFetch = globalThis.fetch;

    try {
      const group = await makeGroup("Consolidated Care");
      const denver = await signUpHome("Denver Chapel");

      await db
        .update(funeralHomesTable)
        .set({
          groupId: group.id,
          subscriptionStatus: "active",
          trialEndsAt: new Date(Date.now() - DAY),
        })
        .where(eq(funeralHomesTable.id, denver.homeId));

      await createCase(denver);

      const sent: Array<Record<string, string>> = [];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        sent.push(Object.fromEntries(new URLSearchParams(String(init.body))));
        return new Response(JSON.stringify({ id: "mbe_g" }), { status: 200 });
      }) as typeof fetch;

      const result = await runCaseMetering();
      expect(result.reported).toBe(1);

      // One invoice for the estate is the entire thing a rollup is buying.
      expect(sent[0]!["payload[stripe_customer_id]"]).toBe("cus_group_1");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env["STRIPE_SECRET_KEY"];
      delete process.env["STRIPE_PRICE_ID_CASE"];
      delete process.env["STRIPE_CASE_METER_EVENT"];
    }
  });

  it("does not let one location buy or cancel its own subscription", async () => {
    const group = await makeGroup("Consolidated Care");
    const denver = await signUpHome("Denver Chapel");

    await db
      .update(funeralHomesTable)
      .set({ groupId: group.id })
      .where(eq(funeralHomesTable.id, denver.homeId));

    const refused = await denver.agent
      .post("/api/billing/checkout")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(409);

    expect(refused.body.error).toMatch(/group/i);

    await denver.agent
      .post("/api/billing/portal")
      .send({ returnUrl: "https://example.com/settings" })
      .expect(409);

    // And the console says whose contract it is, rather than looking broken.
    const billing = await denver.agent.get("/api/billing").expect(200);
    expect(billing.body.group.name).toBe("Consolidated Care");
  });

  it("gives a location that leaves a group time to arrange its own billing", async () => {
    const group = await makeGroup("Consolidated Care");
    const denver = await signUpHome("Denver Chapel");
    await db
      .update(funeralHomesTable)
      .set({ groupId: group.id, subscriptionStatus: "active" })
      .where(eq(funeralHomesTable.id, denver.homeId));

    const admin = await signUpHome("Holding Today");
    const [adminHome] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, admin.homeId));
    expect(adminHome).toBeDefined();

    // The platform list is a table keyed by email; reuse the address this
    // agent registered with. It used to be `PLATFORM_ADMIN_EMAILS`, which is
    // now only a first-start bootstrap — see `lib/platform-auth.ts`.
    const { usersTable, platformAdminsTable } = await import("@workspace/db");
    const [adminUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, admin.userId));
    await db
      .insert(platformAdminsTable)
      .values({ email: adminUser!.email });

    await admin.agent
      .put(`/api/admin/homes/${denver.homeId}/group`)
      .send({ groupId: null })
      .expect(200);

    const [after] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, denver.homeId));

    /*
     * A branch sold to an independent owner on Tuesday has funerals on
     * Wednesday. Cutting it off the moment the paperwork changed would
     * stop a family part-way through uploading photographs of their
     * mother because two companies were renegotiating.
     */
    expect(after!.groupId).toBeNull();
    expect(after!.subscriptionStatus).toBe("trial");
    expect(after!.trialEndsAt!.getTime()).toBeGreaterThan(Date.now());

    await denver.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Still", decedentLastName: "Working" })
      .expect(201);
  });

  it("keeps a group out of its locations' cases", async () => {
    const group = await makeGroup("Consolidated Care");
    const denver = await signUpHome("Denver Chapel");
    const boulder = await signUpHome("Boulder Chapel");

    for (const homeId of [denver.homeId, boulder.homeId]) {
      await db
        .update(funeralHomesTable)
        .set({ groupId: group.id })
        .where(eq(funeralHomesTable.id, homeId));
    }

    const denverCase = await createCase(denver, { decedentLastName: "Denver" });

    /*
     * Membership of a group is a billing relationship and nothing else.
     * Sharing an invoice must never become sharing a family's photographs,
     * and the tenant predicate is what stops it — not a check somebody
     * remembered to write in the group code.
     */
    await boulder.agent.get(`/api/cases/${denverCase.id}`).expect(404);

    const boulderList = await boulder.agent.get("/api/cases").expect(200);
    expect(boulderList.body).toHaveLength(0);

    const [row] = await db
      .select()
      .from(billableCasesTable)
      .where(
        and(
          eq(billableCasesTable.caseId, denverCase.id),
          eq(billableCasesTable.funeralHomeId, denver.homeId),
        ),
      );
    // The charge is attributed to the location that did the work, even
    // though the invoice goes to the group.
    expect(row).toBeDefined();
  });
});

describe("the platform console's side of a group contract", () => {
  /**
   * A signed-in staff account that the platform list also names.
   *
   * A row rather than an environment variable: the list lives in
   * `platform_admins` now, so there is no process-wide state to put back and
   * the truncation between tests takes care of it.
   */
  async function signInPlatformAdmin() {
    const admin = await signUpHome("Holding Today");
    const { usersTable, platformAdminsTable } = await import("@workspace/db");
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, admin.userId));

    await db.insert(platformAdminsTable).values({ email: user!.email });
    return admin;
  }

  it("opens a group, fills it with locations, and counts them", async () => {
    const admin = await signInPlatformAdmin();
    const denver = await signUpHome("Denver Chapel");
    const boulder = await signUpHome("Boulder Chapel");

    const created = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Rocky Mountain Family Care" })
      .expect(201);

    expect(created.body.slug).toBe("rocky-mountain-family-care");
    expect(created.body.locations).toBe(0);
    // A group tries it on one location before signing for forty.
    expect(created.body.subscriptionStatus).toBe("trial");

    for (const home of [denver, boulder]) {
      await admin.agent
        .put(`/api/admin/homes/${home.homeId}/group`)
        .send({ groupId: created.body.id })
        .expect(200);
    }

    const detail = await admin.agent
      .get(`/api/admin/groups/${created.body.id}`)
      .expect(200);

    expect(detail.body.locations).toHaveLength(2);
    expect(detail.body.locations.map((l: { name: string }) => l.name).sort()).toEqual([
      "Boulder Chapel",
      "Denver Chapel",
    ]);
  });

  it("refuses to double-bill a home that already pays for itself", async () => {
    const admin = await signInPlatformAdmin();
    const denver = await signUpHome("Denver Chapel");
    await makePaying(denver.homeId);

    const created = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Consolidated Care" })
      .expect(201);

    const refused = await admin.agent
      .put(`/api/admin/homes/${denver.homeId}/group`)
      .send({ groupId: created.body.id })
      .expect(409);

    /*
     * The quiet version of this bug is a group paying one consolidated
     * invoice while the Denver branch keeps paying its own, found by
     * somebody in accounts a quarter later. That is the worst way for a
     * vendor to be wrong about money.
     */
    expect(refused.body.error).toMatch(/cancel it in Stripe/i);
  });

  it("will not start a contract for a group with nothing in it", async () => {
    const admin = await signInPlatformAdmin();

    const created = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Empty Holdings" })
      .expect(201);

    await admin.agent
      .post(`/api/admin/groups/${created.body.id}/checkout`)
      .send({ returnUrl: "https://example.com", email: "cfo@example.com" })
      .expect(400);
  });

  it("keeps a director out of the group console", async () => {
    await signInPlatformAdmin();
    const denver = await signUpHome("Denver Chapel");

    // The platform allowlist is by email, and this director is not on it.
    await denver.agent.get("/api/admin/groups").expect(403);
    await denver.agent
      .post("/api/admin/groups")
      .send({ name: "My Own Empire" })
      .expect(403);
    await denver.agent
      .put(`/api/admin/homes/${denver.homeId}/group`)
      .send({ groupId: null })
      .expect(403);
  });

  it("writes a line in the audit log for everything it does", async () => {
    const admin = await signInPlatformAdmin();
    const { platformAuditTable } = await import("@workspace/db");

    const created = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Consolidated Care" })
      .expect(201);
    await admin.agent.get(`/api/admin/groups/${created.body.id}`).expect(200);
    await admin.agent.get("/api/admin/groups").expect(200);

    const rows = await db.select().from(platformAuditTable);
    const actions = rows.map((row) => row.action);

    // Group rows hold no family data, but the console is still the one
    // place that reads across tenants and it logs without exception.
    expect(actions).toContain("group.create");
    expect(actions).toContain("group.open");
    expect(actions).toContain("group.list");
  });
});
