import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  casesTable,
  funeralHomesTable,
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
