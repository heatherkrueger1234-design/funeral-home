import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  funeralHomesTable,
  homeGroupsTable,
  passwordResetsTable,
  platformAdminsTable,
  platformAuditTable,
  usersTable,
  aftercareEnrollmentsTable,
  aftercareDeliveriesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  createCase,
  inviteFamily,
  markEmailVerified,
  signUpHome,
} from "./helpers";

/**
 * The platform console after a review of it as the person who runs it.
 *
 * Most of what is tested here is about the access log, because the log is the
 * page shown to customers as the truth: it must not fill with the same look
 * a dozen times, it must not claim a change that was refused, and the console
 * must never be handed a link that would let it sign in as somebody. The rest
 * is the console being able to do the ordinary things -- find our own homes
 * again, invite an owner into an empty home, give a trial a few more days.
 */

const ADMIN_EMAIL = "heather@continuumaftercare.example";
const PASSWORD = "correct-horse-battery";

async function signInAdmin() {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ homeName: "Continuum Aftercare", email: ADMIN_EMAIL, password: PASSWORD })
    .expect(201);
  await markEmailVerified(ADMIN_EMAIL);
  return { agent, homeId: res.body.home.id as number };
}

async function auditRows(action?: string) {
  const rows = await db.select().from(platformAuditTable).orderBy(platformAuditTable.id);
  return action ? rows.filter((row) => row.action === action) : rows;
}

beforeEach(async () => {
  await db.insert(platformAdminsTable).values({ email: ADMIN_EMAIL });
});

/* --------------------------------------------------------- log noise -- */

describe("the log records a look once, not once per request", () => {
  it("writes one line for the same home opened repeatedly", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    for (let i = 0; i < 4; i += 1) {
      await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);
    }
    await admin.agent.get("/api/admin/overview").expect(200);
    await admin.agent.get("/api/admin/overview").expect(200);

    expect(await auditRows("home.open")).toHaveLength(1);
    expect(await auditRows("platform.overview")).toHaveLength(1);
  });

  it("still logs a different home, a different search, and every change", async () => {
    const admin = await signInAdmin();
    const first = await signUpHome("Horan & McConaty");
    const second = await signUpHome("Olinger Chapel");

    await admin.agent.get(`/api/admin/homes/${first.homeId}`).expect(200);
    await admin.agent.get(`/api/admin/homes/${second.homeId}`).expect(200);
    expect(await auditRows("home.open")).toHaveLength(2);

    await admin.agent.get("/api/admin/homes?search=Horan").expect(200);
    await admin.agent.get("/api/admin/homes?search=Olinger").expect(200);
    await admin.agent.get("/api/admin/homes?search=Horan").expect(200);
    expect(await auditRows("homes.list")).toHaveLength(2);

    for (const reason of ["Chargeback", "Chargeback"]) {
      await admin.agent
        .put(`/api/admin/homes/${first.homeId}/suspension`)
        .send({ suspended: true, reason })
        .expect(200);
    }
    expect(await auditRows("home.suspend")).toHaveLength(2);
  });

  it("logs the look again once the window has passed", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);
    await db
      .update(platformAuditTable)
      .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) });
    await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);

    expect(await auditRows("home.open")).toHaveLength(2);
  });
});

/* ------------------------------------------- refused means not logged -- */

describe("a refused change leaves no line saying it happened", () => {
  it("does not log a move into a group that does not exist", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/group`)
      .send({ groupId: 999 })
      .expect(404);

    expect(await auditRows("home.group.update")).toHaveLength(0);

    const [group] = await db
      .insert(homeGroupsTable)
      .values({ name: "Front Range", slug: "front-range" })
      .returning();

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/group`)
      .send({ groupId: group!.id })
      .expect(200);

    const logged = await auditRows("home.group.update");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.subjectHomeId).toBe(home.homeId);
  });

  it("does not log a reset aimed at somebody from another home", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    const other = await signUpHome("Olinger Chapel");

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/staff/${other.userId}/password-reset`)
      .expect(404);

    expect(await auditRows("home.staff.reset")).toHaveLength(0);
  });
});

/* ---------------------------------------------------- the invitation -- */

describe("invitations", () => {
  it("never hands the console the link that sets an owner's password", async () => {
    const admin = await signInAdmin();

    const created = await admin.agent
      .post("/api/admin/homes")
      .send({ name: "Green Lawn", ownerEmail: "owner@greenlawn.example" })
      .expect(201);

    expect(created.body.mailSent).toBe(false);
    expect(JSON.stringify(created.body)).not.toMatch(/token|reset-password|invited=1/);

    // The token exists -- it went to the owner's inbox -- it just did not
    // come back here.
    const resets = await db.select().from(passwordResetsTable);
    expect(resets).toHaveLength(1);
  });

  it("invites an owner into a home that was created with nobody", async () => {
    const admin = await signInAdmin();

    const created = await admin.agent
      .post("/api/admin/homes")
      .send({ name: "Green Lawn" })
      .expect(201);

    const invited = await admin.agent
      .post(`/api/admin/homes/${created.body.id}/invite-owner`)
      .send({ email: "Owner@GreenLawn.example", name: "Dana Reyes" })
      .expect(201);

    expect(invited.body).toEqual({ mailSent: false });

    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.funeralHomeId, created.body.id));
    expect(owner).toMatchObject({
      email: "owner@greenlawn.example",
      displayName: "Dana Reyes",
      role: "owner",
      passwordHash: null,
    });

    const logged = await auditRows("home.owner.invite");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.subjectHomeId).toBe(created.body.id);
    // The address is the home's business, not the log's.
    expect(JSON.stringify(logged)).not.toContain("greenlawn");

    // Once there is an owner, anybody else is theirs to invite.
    await admin.agent
      .post(`/api/admin/homes/${created.body.id}/invite-owner`)
      .send({ email: "second@greenlawn.example" })
      .expect(409);
    expect(await auditRows("home.owner.invite")).toHaveLength(1);
  });

  it("refuses an address that already has an account, without logging", async () => {
    const admin = await signInAdmin();
    const created = await admin.agent
      .post("/api/admin/homes")
      .send({ name: "Green Lawn" })
      .expect(201);

    await admin.agent
      .post(`/api/admin/homes/${created.body.id}/invite-owner`)
      .send({ email: ADMIN_EMAIL })
      .expect(400);

    expect(await auditRows("home.owner.invite")).toHaveLength(0);
  });

  it("resends the invitation to somebody who never set a password", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    const added = await home.agent
      .post("/api/home/staff")
      .send({ email: "pat@horan.example", displayName: "Pat", role: "director" })
      .expect(201);

    const res = await admin.agent
      .post(`/api/admin/homes/${home.homeId}/staff/${added.body.id}/password-reset`)
      .expect(202);

    expect(Object.keys(res.body)).toEqual(["mailConfigured"]);

    const [entry] = await auditRows("home.staff.reset");
    expect(entry!.detail).toContain("resent the invitation");
  });
});

/* ------------------------------------------------------ our own homes -- */

describe("our own homes", () => {
  it("are left out of the list unless asked for, and marked when they are", async () => {
    const admin = await signInAdmin();
    await signUpHome("Horan & McConaty");

    await db
      .update(funeralHomesTable)
      .set({ internalAccount: true })
      .where(eq(funeralHomesTable.id, admin.homeId));

    const customers = await admin.agent.get("/api/admin/homes").expect(200);
    expect(customers.body.homes.map((h: { name: string }) => h.name)).toEqual([
      "Horan & McConaty",
    ]);

    const everything = await admin.agent
      .get("/api/admin/homes?includeInternal=true")
      .expect(200);
    expect(everything.body.total).toBe(2);
    const ours = everything.body.homes.find(
      (h: { id: number }) => h.id === admin.homeId,
    );
    expect(ours.internalAccount).toBe(true);

    // "false" is false, not a truthy string.
    const unticked = await admin.agent
      .get("/api/admin/homes?includeInternal=false")
      .expect(200);
    expect(unticked.body.total).toBe(1);
  });
});

/* ------------------------------------------------------------ billing -- */

describe("billing, visibly", () => {
  it("shows the dates behind a home's status and filters the list by it", async () => {
    const admin = await signInAdmin();
    const trial = await signUpHome("Horan & McConaty");
    const late = await signUpHome("Olinger Chapel");

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "past_due", currentPeriodEndsAt: new Date() })
      .where(eq(funeralHomesTable.id, late.homeId));

    const detail = await admin.agent.get(`/api/admin/homes/${trial.homeId}`).expect(200);
    expect(detail.body).toMatchObject({
      subscriptionStatus: "trial",
      groupId: null,
      groupName: null,
      canOpenCases: true,
    });
    expect(Date.parse(detail.body.trialEndsAt)).toBeGreaterThan(Date.now());
    expect(detail.body).toHaveProperty("currentPeriodEndsAt");

    const pastDue = await admin.agent.get("/api/admin/homes?status=past_due").expect(200);
    expect(pastDue.body.homes.map((h: { id: number }) => h.id)).toEqual([late.homeId]);

    await admin.agent.get("/api/admin/homes?status=nonsense").expect(400);
  });

  it("counts the homes whose money is going wrong, and the trials ending this week", async () => {
    const admin = await signInAdmin();
    const soon = await signUpHome("Horan & McConaty");
    const later = await signUpHome("Olinger Chapel");
    const late = await signUpHome("Crown Hill");
    const gone = await signUpHome("Fairmount");

    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) })
      .where(eq(funeralHomesTable.id, soon.homeId));
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "past_due" })
      .where(eq(funeralHomesTable.id, late.homeId));
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, gone.homeId));

    const res = await admin.agent.get("/api/admin/overview").expect(200);
    expect(res.body.homes).toMatchObject({ pastDue: 1, canceled: 1 });
    expect(res.body.trialsEndingSoon.map((h: { id: number }) => h.id)).toEqual([
      soon.homeId,
    ]);
    expect(
      res.body.trialsEndingSoon.some((h: { id: number }) => h.id === later.homeId),
    ).toBe(false);
  });

  it("extends a trial from its current end, and logs it", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    const end = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    await db
      .update(funeralHomesTable)
      .set({ trialEndsAt: end, trialRemindersSent: "trial-7" })
      .where(eq(funeralHomesTable.id, home.homeId));

    const res = await admin.agent
      .post(`/api/admin/homes/${home.homeId}/extend-trial`)
      .send({ days: 10 })
      .expect(200);

    expect(Date.parse(res.body.trialEndsAt)).toBe(end.getTime() + 10 * 24 * 60 * 60 * 1000);

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, home.homeId));
    expect(row!.trialRemindersSent).toBe("");

    const [entry] = await auditRows("home.trial.extend");
    expect(entry!.detail).toContain("10 more days");

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/extend-trial`)
      .send({ days: 61 })
      .expect(400);
  });

  it("will not extend a trial for a subscribed home, and does not log the refusal", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active" })
      .where(eq(funeralHomesTable.id, home.homeId));

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/extend-trial`)
      .send({ days: 10 })
      .expect(400);

    expect(await auditRows("home.trial.extend")).toHaveLength(0);
  });

  it("reports the last failed send as a UTC instant", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    const theirCase = await createCase(home);
    const { contactId } = await inviteFamily(home, theirCase.id);

    const [enrollment] = await db
      .insert(aftercareEnrollmentsTable)
      .values({
        funeralHomeId: home.homeId,
        caseId: theirCase.id,
        contactId,
        email: "anne@example.com",
        startsAt: new Date(),
        brandedAs: "Horan & McConaty",
      })
      .returning();

    const failedAt = new Date("2026-09-14T16:02:11.500Z");
    await db.insert(aftercareDeliveriesTable).values({
      enrollmentId: enrollment!.id,
      dayOffset: 30,
      dueAt: new Date(),
      failedAt: new Date(Math.max(failedAt.getTime(), Date.now() - 60_000)),
      failureReason: "550 refused",
    });

    const res = await admin.agent.get("/api/admin/overview").expect(200);
    expect(res.body.delivery.lastFailureAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

/* ------------------------------------------------------------ the log -- */

describe("reading the log", () => {
  it("pages backwards by id and filters by home and by action", async () => {
    const admin = await signInAdmin();
    const first = await signUpHome("Horan & McConaty");
    const second = await signUpHome("Olinger Chapel");

    await admin.agent.get(`/api/admin/homes/${first.homeId}`).expect(200);
    await admin.agent.get(`/api/admin/homes/${second.homeId}`).expect(200);
    await admin.agent
      .put(`/api/admin/homes/${first.homeId}/suspension`)
      .send({ suspended: true, reason: "Chargeback" })
      .expect(200);

    const newest = await admin.agent.get("/api/admin/audit?limit=2").expect(200);
    expect(newest.body).toHaveLength(2);

    const older = await admin.agent
      .get(`/api/admin/audit?limit=2&before=${newest.body[1].id}`)
      .expect(200);
    expect(older.body.map((row: { id: number }) => row.id)).not.toContain(
      newest.body[0].id,
    );
    expect(older.body.every((row: { id: number }) => row.id < newest.body[1].id)).toBe(
      true,
    );

    const forFirst = await admin.agent
      .get(`/api/admin/audit?homeId=${first.homeId}`)
      .expect(200);
    expect(
      forFirst.body.every((row: { subjectHomeId: number }) => row.subjectHomeId === first.homeId),
    ).toBe(true);
    expect(forFirst.body).toHaveLength(2);

    const suspensions = await admin.agent
      .get("/api/admin/audit?action=home.suspend")
      .expect(200);
    expect(suspensions.body).toHaveLength(1);

    await admin.agent.get("/api/admin/audit?action=made.up").expect(400);
  });
});

/* ------------------------------------------------ restoring an admin -- */

describe("restoring somebody's access", () => {
  it("keeps their name and note, and the log says what was undone", async () => {
    const admin = await signInAdmin();
    await db.insert(platformAdminsTable).values({
      email: "rejoiner@continuumaftercare.example",
      displayName: "Sam Ortiz",
      note: "Support lead",
      revokedAt: new Date("2026-03-02T12:00:00Z"),
      revokedByEmail: "someone@continuumaftercare.example",
    });

    await admin.agent
      .post("/api/admin/admins")
      .send({ email: "rejoiner@continuumaftercare.example" })
      .expect(201);

    const [row] = await db
      .select()
      .from(platformAdminsTable)
      .where(
        and(
          eq(platformAdminsTable.email, "rejoiner@continuumaftercare.example"),
        ),
      );
    expect(row).toMatchObject({
      displayName: "Sam Ortiz",
      note: "Support lead",
      revokedAt: null,
      addedByEmail: ADMIN_EMAIL,
    });

    const [entry] = await auditRows("platform.admin.grant");
    expect(entry!.detail).toContain("restored rejoiner@continuumaftercare.example");
    expect(entry!.detail).toContain("2026-03-02");
    expect(entry!.detail).toContain("someone@continuumaftercare.example");
  });
});
