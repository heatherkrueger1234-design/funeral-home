import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  casesTable,
  funeralHomesTable,
  homeGroupsTable,
  platformAdminsTable,
  platformAuditTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createCase, markEmailVerified, signUpHome } from "./helpers";

/**
 * The tools the console grew once groups had a screen and the overview had
 * to say who to ring: what each one returns, and the two ways the group move
 * could quietly cost somebody money.
 */

const ADMIN = "heather@continuumaftercare.example";
const DAY = 24 * 60 * 60 * 1000;

async function signInAdmin() {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({
      homeName: "Continuum Aftercare",
      email: ADMIN,
      password: "correct-horse-battery",
    })
    .expect(201);
  await markEmailVerified(ADMIN);

  // Ours, so it stays out of every figure below.
  await db
    .update(funeralHomesTable)
    .set({ internalAccount: true })
    .where(eq(funeralHomesTable.id, res.body.home.id));

  return { agent, homeId: res.body.home.id as number };
}

beforeEach(async () => {
  await db.insert(platformAdminsTable).values({ email: ADMIN });
});

describe("worth a call", () => {
  it("lists trials about to end, and trials that ended without subscribing", async () => {
    const admin = await signInAdmin();
    const soon = await signUpHome("Aspen Grove");
    const lapsed = await signUpHome("Pikes Peak");
    const later = await signUpHome("Mesa Verde");

    const at = (days: number) => new Date(Date.now() + days * DAY);
    await db.update(funeralHomesTable).set({ trialEndsAt: at(5) }).where(eq(funeralHomesTable.id, soon.homeId));
    await db.update(funeralHomesTable).set({ trialEndsAt: at(-10) }).where(eq(funeralHomesTable.id, lapsed.homeId));
    await db.update(funeralHomesTable).set({ trialEndsAt: at(25) }).where(eq(funeralHomesTable.id, later.homeId));

    const res = await admin.agent.get("/api/admin/overview").expect(200);
    const names = res.body.trials.map((row: { home: { name: string } }) => row.home.name);

    // Soonest first, the lapsed one included, the one a month out not.
    expect(names).toEqual(["Pikes Peak", "Aspen Grove"]);
  });

  it("names a home that has gone a month without a case, and says only that", async () => {
    const admin = await signInAdmin();
    const busy = await signUpHome("Horan & McConaty");
    const quiet = await signUpHome("Green Lawn");

    await createCase(busy);
    const old = await createCase(quiet);
    await db
      .update(casesTable)
      .set({ createdAt: new Date(Date.now() - 45 * DAY) })
      .where(eq(casesTable.id, old.id));

    const res = await admin.agent.get("/api/admin/overview").expect(200);

    expect(res.body.quiet).toHaveLength(1);
    expect(res.body.quiet[0].home.name).toBe("Green Lawn");
    expect(res.body.quiet[0].reason).toBe("No case opened in the last thirty days.");
    expect(res.body.quiet[0].lastCaseAt).not.toBeNull();
    // A count and a date, never whose case it was.
    expect(JSON.stringify(res.body.quiet)).not.toContain("Margaret");
  });
});

describe("groups from the console", () => {
  it("does not reset an independent home when asked to take it out of a group it is not in", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active", trialEndsAt: null })
      .where(eq(funeralHomesTable.id, home.homeId));

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/group`)
      .send({ groupId: null })
      .expect(400);

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, home.homeId));
    expect(row!.subscriptionStatus).toBe("active");
  });

  it("moves a home in by name, shows it on the home, and logs the group's name", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    const group = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Front Range Group" })
      .expect(201);

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/group`)
      .send({ groupId: group.body.id })
      .expect(200);

    const detail = await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);
    expect(detail.body.groupId).toBe(group.body.id);
    expect(detail.body.group).toEqual({ id: group.body.id, name: "Front Range Group" });

    const opened = await admin.agent.get(`/api/admin/groups/${group.body.id}`).expect(200);
    expect(opened.body.billingConfigured).toBe(false);
    expect(opened.body.locations).toHaveLength(1);

    const log = await db.select().from(platformAuditTable);
    expect(log.map((row) => row.detail)).toContain('Moved into "Front Range Group"');
  });

  it("takes in a home whose own subscription has ended, and refuses one still running", async () => {
    const admin = await signInAdmin();
    const ended = await signUpHome("Horan & McConaty");
    const running = await signUpHome("Aspen & Vale");
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_ended" })
      .where(eq(funeralHomesTable.id, ended.homeId));
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "trial", stripeSubscriptionId: "sub_trialing" })
      .where(eq(funeralHomesTable.id, running.homeId));

    const group = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Front Range Group" })
      .expect(201);

    // A subscription that has ended charges nobody, so there is nothing
    // to be charged for twice.
    await admin.agent
      .put(`/api/admin/homes/${ended.homeId}/group`)
      .send({ groupId: group.body.id })
      .expect(200);

    // A trial Stripe holds becomes a charge by itself.
    await admin.agent
      .put(`/api/admin/homes/${running.homeId}/group`)
      .send({ groupId: group.body.id })
      .expect(409);
  });

  describe("and the group's bill", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    /** A group on a live contract, billed for `locations` locations. */
    async function payingGroup(locations: number) {
      const [group] = await db
        .insert(homeGroupsTable)
        .values({
          name: "Front Range Group",
          slug: "front-range-group",
          subscriptionStatus: "active",
          stripeCustomerId: "cus_group",
          stripeSubscriptionId: "sub_group",
        })
        .returning();
      for (let i = 0; i < locations; i += 1) {
        const home = await signUpHome(`Location ${i + 1}`);
        await db
          .update(funeralHomesTable)
          .set({ groupId: group!.id, subscriptionStatus: "active" })
          .where(eq(funeralHomesTable.id, home.homeId));
      }
      return group!;
    }

    /** Stripe holding the group's subscription: a seat line and a metered line. */
    function stripeHoldsGroup(options: { refuseChanges?: boolean } = {}) {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_notreal");
      vi.stubEnv("STRIPE_PRICE_ID", "price_base");
      const changes: URLSearchParams[] = [];
      let seats = 2;
      vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: URLSearchParams }) => {
        if (init?.method === "POST") {
          if (options.refuseChanges) {
            return Response.json({ error: { message: "Stripe is having a moment" } }, { status: 500 });
          }
          const body = new URLSearchParams(String(init.body));
          changes.push(body);
          seats = Number(body.get("items[0][quantity]"));
          return Response.json({ id: "sub_group" });
        }
        expect(new URL(url).pathname).toBe("/v1/subscriptions/sub_group");
        return Response.json({
          id: "sub_group",
          status: "active",
          customer: "cus_group",
          items: {
            data: [
              { id: "si_seats", quantity: seats, price: { id: "price_base", recurring: { usage_type: "licensed" } } },
              { id: "si_funerals", price: { id: "price_case", recurring: { usage_type: "metered" } } },
            ],
          },
        });
      });
      return changes;
    }

    it("charges the group for the locations it has, as they come and go", async () => {
      const admin = await signInAdmin();
      const group = await payingGroup(2);
      const changes = stripeHoldsGroup();
      const joining = await signUpHome("Horan & McConaty");

      // The contract was bought for two. A third location joining without
      // the bill moving is a branch run for free until somebody notices.
      const joined = await admin.agent
        .put(`/api/admin/homes/${joining.homeId}/group`)
        .send({ groupId: group.id })
        .expect(200);
      expect(joined.body.billingWarning).toBeUndefined();
      expect(changes).toHaveLength(1);
      expect(changes[0]!.get("items[0][id]")).toBe("si_seats");
      expect(changes[0]!.get("items[0][quantity]")).toBe("3");
      // The funeral line is metered: it has no quantity, and Stripe refuses one.
      expect(changes[0]!.get("items[1][id]")).toBeNull();

      await admin.agent
        .put(`/api/admin/homes/${joining.homeId}/group`)
        .send({ groupId: null })
        .expect(200);
      expect(changes).toHaveLength(2);
      expect(changes[1]!.get("items[0][quantity]")).toBe("2");
    });

    it("still moves the location when Stripe cannot be told, and says what to fix", async () => {
      const admin = await signInAdmin();
      const group = await payingGroup(2);
      stripeHoldsGroup({ refuseChanges: true });
      const joining = await signUpHome("Horan & McConaty");

      const joined = await admin.agent
        .put(`/api/admin/homes/${joining.homeId}/group`)
        .send({ groupId: group.id })
        .expect(200);

      // The branch has funerals this week whatever Stripe is doing.
      expect(joined.body.groupId).toBe(group.id);
      expect(joined.body.billingWarning).toMatch(/Front Range Group/);
      expect(joined.body.billingWarning).toMatch(/3 locations/);
    });
  });

  it("refuses a group that does not exist without logging a move", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/group`)
      .send({ groupId: 999 })
      .expect(404);

    const log = await db.select().from(platformAuditTable);
    expect(log.some((row) => row.action === "home.group.update")).toBe(false);
  });

  it("asks for a real return address before starting a checkout", async () => {
    const admin = await signInAdmin();
    const group = await admin.agent
      .post("/api/admin/groups")
      .send({ name: "Front Range Group" })
      .expect(201);

    await admin.agent
      .post(`/api/admin/groups/${group.body.id}/checkout`)
      .send({ email: "billing@frontrange.example", returnUrl: "javascript:alert(1)" })
      .expect(400);
  });
});

describe("finding things again", () => {
  it("lists our own homes only when asked", async () => {
    const admin = await signInAdmin();
    await signUpHome("Horan & McConaty");

    const customers = await admin.agent.get("/api/admin/homes").expect(200);
    expect(customers.body.homes.map((h: { name: string }) => h.name)).toEqual(["Horan & McConaty"]);

    const ours = await admin.agent.get("/api/admin/homes?ours=true").expect(200);
    expect(ours.body.homes.map((h: { name: string }) => h.name)).toEqual(["Continuum Aftercare"]);
  });

  it("filters the log by what was done", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);
    await admin.agent.get("/api/admin/overview").expect(200);

    const res = await admin.agent.get("/api/admin/audit?action=home.open").expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((row: { action: string }) => row.action === "home.open")).toBe(true);

    await admin.agent.get("/api/admin/audit?action=not.a.thing").expect(400);
  });

  it("answers an address containing a percent sign rather than failing", async () => {
    const admin = await signInAdmin();

    // Express has decoded the path once already; decoding it again threw.
    const res = await admin.agent
      .delete(`/api/admin/admins/${encodeURIComponent("100%@example.com")}`)
      .expect(400);
    expect(res.body.error).toBe("That address is not on the list.");
  });
});
