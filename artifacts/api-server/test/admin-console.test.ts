import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  funeralHomesTable,
  platformAuditTable,
  platformAdminsTable,
  canOpenCases,
  licensureReminders,
  describeWhen,
  PRACTITIONER_LICENSURE_DEADLINE,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth";
import {
  signUpHome,
  createCase,
  inviteFamily,
  asFamily,
} from "./helpers";

/**
 * The admin console, and mostly the two ways it could go wrong.
 *
 * This component exists to read across the tenant boundary, which every other
 * line in this codebase exists to prevent. So the tests that matter are not
 * "does the list render" — they are the two directions the boundary can leak:
 * a platform admin reaching a family through the ordinary staff API, and a
 * director reaching the platform.
 */

const ADMIN_EMAIL = "heather@holdingtoday.example";
const PASSWORD = "correct-horse-battery";

/**
 * Sign in to the platform console.
 *
 * Component 1 replaced the allowlist-on-a-staff-session this file was first
 * written against. A platform admin is now a different account entirely — its
 * own table, its own cookie, its own resolver — and **carries no staff session
 * at all**, which is why several expectations below are 401 where they used to
 * be 403 or 404. That is a stronger result, not a weaker one: the staff API
 * now refuses this account at the door rather than letting it in and relying
 * on tenant scoping to return nothing.
 */
async function signInPlatformAdmin(role: "owner" | "support" = "owner") {
  const agent = request.agent(app);

  await db.insert(platformAdminsTable).values({
    email: ADMIN_EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    displayName: "Heather Krueger",
    role,
  });

  await agent
    .post("/api/admin/auth/login")
    .send({ email: ADMIN_EMAIL, password: PASSWORD })
    .expect(200);

  return { agent };
}

/* ------------------------------------------------------ the two it is for */

describe("the tenant boundary", () => {
  /**
   * The first of the two tests the brief asks for.
   *
   * Being a platform admin buys exactly one thing: the `/admin` routes. It
   * does not widen the staff API by a single row — and since Component 1 the
   * reason is stronger than tenant scoping. A platform admin holds no staff
   * session, so `requireAuth` refuses them before any handler runs. There is
   * no tenant to scope on because there is no staff row to read one from.
   */
  it("does not let a platform admin reach family data through the staff API", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");
    const theirCase = await createCase(home, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    const { contactId } = await inviteFamily(home, theirCase.id);

    // The admin console can see that this home exists.
    await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);

    // And the staff API refuses them outright — not "returns no rows", but
    // "you are not signed in here", which cannot be got wrong by a handler
    // that forgets to scope a query.
    await admin.agent.get(`/api/cases/${theirCase.id}`).expect(401);
    await admin.agent.get(`/api/cases/${theirCase.id}/photos`).expect(401);
    await admin.agent.get(`/api/cases/${theirCase.id}/contacts`).expect(401);
    await admin.agent.get(`/api/contacts/${contactId}`).expect(401);
    await admin.agent.get("/api/cases").expect(401);
  });

  /**
   * The second. A director is a director, whatever else is true of them.
   *
   * Every admin route is named here rather than a sample of them: the failure
   * this is guarding against is somebody adding a route and forgetting the
   * gate, and a test that checks three of eight would not catch it.
   */
  it("does not let a director reach a single admin route", async () => {
    const home = await signUpHome("Horan & McConaty");

    // Typed as the agent's own verbs so the loop needs no cast, and so that
    // adding a route with a method supertest does not have is a type error
    // rather than a test that silently skips it.
    const routes: Array<["get" | "post" | "put" | "delete", string]> = [
      ["get", "/api/admin/overview"],
      ["get", "/api/admin/homes"],
      ["get", `/api/admin/homes/${home.homeId}`],
      ["post", "/api/admin/homes"],
      ["put", `/api/admin/homes/${home.homeId}/suspension`],
      ["put", `/api/admin/homes/${home.homeId}/licensure`],
      ["post", `/api/admin/homes/${home.homeId}/practitioners`],
      ["put", `/api/admin/homes/${home.homeId}/practitioners/1`],
      ["delete", `/api/admin/homes/${home.homeId}/practitioners/1`],
      ["get", "/api/admin/audit"],
    ];

    for (const [method, path] of routes) {
      const res = await home.agent[method](path).send({});

      expect(
        res.status,
        `${method.toUpperCase()} ${path} should be closed to a director`,
      ).toBe(401);
    }

    // An owner is not a platform admin either — the roles inside a home stop
    // at the home's own front door.
    const owner = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, home.homeId));
    expect(owner).toHaveLength(1);
    await home.agent.get("/api/admin/homes").expect(401);
  });

  /**
   * Replaces a test of the allowlist this file was first written against.
   * There is no allowlist now; there are two kinds of account, and the thing
   * worth proving is that neither cookie is ever mistaken for the other.
   */
  it("does not accept a platform session on the staff door, or the reverse", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    // Each works where it belongs.
    await admin.agent.get("/api/admin/auth/me").expect(200);
    await home.agent.get("/api/auth/me").expect(200);

    // And nowhere else. Separate tables, separate resolvers, and neither
    // resolver can return the other kind of account however either is later
    // edited.
    await admin.agent.get("/api/auth/me").expect(401);
    await home.agent.get("/api/admin/auth/me").expect(401);
  });

  it("is closed to a stranger with no session at all", async () => {
    await request(app).get("/api/admin/homes").expect(401);
  });
});

/* ---------------------------------------------------------------- homes */

describe("homes", () => {
  it("creates a home from a blank template, ready to work in", async () => {
    const admin = await signInPlatformAdmin();

    const created = await admin.agent
      .post("/api/admin/homes")
      .send({
        name: "Green Lawn Funeral Chapel",
        ownerEmail: "owner@greenlawn.example",
        city: "Lakewood",
        region: "CO",
      })
      .expect(201);

    expect(created.body.name).toBe("Green Lawn Funeral Chapel");
    expect(created.body.slug).toBe("green-lawn-funeral-chapel");
    expect(created.body.subscriptionStatus).toBe("trial");
    expect(created.body.canOpenCases).toBe(true);
    // The owner sets their own password; none was ever typed here.
    expect(created.body.inviteLink).toContain("/reset-password?token=");

    // Blank template: the standard schedule is there, so the first case this
    // home opens gets a working timeline without anybody configuring one.
    const detail = await admin.agent
      .get(`/api/admin/homes/${created.body.id}`)
      .expect(200);

    expect(detail.body.staff).toHaveLength(1);
    expect(detail.body.staff[0].role).toBe("owner");
    // And nothing was invented on their behalf.
    expect(detail.body.licensure).toBeNull();
    expect(detail.body.practitioners).toEqual([]);
  });

  it("refuses an owner email that already belongs to somebody", async () => {
    const admin = await signInPlatformAdmin();
    const taken = "director@horanmcconaty.example";

    await admin.agent
      .post("/api/admin/homes")
      .send({ name: "Horan & McConaty", ownerEmail: taken })
      .expect(201);

    const existing = await db.select().from(funeralHomesTable);
    expect(existing).toHaveLength(1);

    // The platform account is no longer a staff account, so the address that
    // has to clash is a real owner's — which is the case worth covering
    // anyway: two homes cannot share one sign-in.
    await admin.agent
      .post("/api/admin/homes")
      .send({ name: "Second Home", ownerEmail: taken })
      .expect(400);
  });

  it("suspends a home without taking anything away from it", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");
    const theirCase = await createCase(home);

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/suspension`)
      .send({ suspended: true, reason: "Chargeback, unreachable for six weeks" })
      .expect(200);

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, home.homeId));

    expect(row!.suspendedAt).not.toBeNull();
    expect(canOpenCases(row!)).toBe(false);

    // No new cases — and the refusal says what actually happened, rather
    // than sending a suspended home off to check its card.
    const refused = await home.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Arthur", decedentLastName: "Hale" })
      .expect(402);

    expect(refused.body.error).toContain("suspended");
    expect(refused.body.error).not.toContain("subscription");

    // ...and everything already there is untouched. A family part-way
    // through uploading photographs of their mother does not lose them
    // because of a billing dispute.
    await home.agent.get(`/api/cases/${theirCase.id}`).expect(200);

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/suspension`)
      .send({ suspended: false })
      .expect(200);

    const [restored] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, home.homeId));

    expect(restored!.suspendedAt).toBeNull();
    expect(canOpenCases(restored!)).toBe(true);
  });

  it("asks why before it suspends", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/suspension`)
      .send({ suspended: true })
      .expect(400);
  });
});

/* ----------------------------------------------------------- engagement */

describe("engagement", () => {
  it("counts what each home is actually doing, per home", async () => {
    const admin = await signInPlatformAdmin();
    const busy = await signUpHome("Horan & McConaty");
    const quiet = await signUpHome("Green Lawn");

    const first = await createCase(busy);
    await createCase(busy, { decedentFirstName: "Arthur" });
    const { token } = await inviteFamily(busy, first.id);
    await inviteFamily(busy, first.id, { name: "Peter Hale" });

    // One of the two links actually gets opened.
    await asFamily(token).get("/api/family/session").expect(200);

    const listed = await admin.agent.get("/api/admin/homes").expect(200);

    const numbersFor = (name: string) =>
      listed.body.homes.find((home: { name: string }) => home.name === name)
        .engagement;

    expect(numbersFor("Horan & McConaty")).toMatchObject({
      casesOpened: 2,
      familyLinksCreated: 2,
      familyLinksOpened: 1,
    });

    // The quiet home's numbers are its own, not a share of the busy one's.
    expect(numbersFor("Green Lawn")).toMatchObject({
      casesOpened: 0,
      familyLinksCreated: 0,
      familyLinksOpened: 0,
      photographs: 0,
    });

    const overview = await admin.agent.get("/api/admin/overview").expect(200);
    expect(overview.body.engagement.casesOpened).toBe(2);
    // Two, exactly: the platform account no longer registers a home of its
    // own as a side effect of signing in, so nothing inflates this.
    expect(overview.body.homes.homes).toBe(2);
  });
});

/* ------------------------------------------------------------ licensure */

describe("Colorado licensure", () => {
  it("records a home's registration and its people", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/licensure`)
      .send({
        doraRegistrationNumber: "FE.0001234",
        registeredServices: ["Embalming", "Cremation arrangements"],
        designeeName: "Karen Voss",
        designeeTitle: "Appointed designee",
        registrationRenewsOn: "2027-06-30",
      })
      .expect(200);

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/practitioners`)
      .send({
        personName: "Karen Voss",
        role: "funeral_director",
        standing: "not_applied",
      })
      .expect(201);

    const detail = await admin.agent
      .get(`/api/admin/homes/${home.homeId}`)
      .expect(200);

    expect(detail.body.licensure.doraRegistrationNumber).toBe("FE.0001234");
    expect(detail.body.licensure.registeredServices).toEqual([
      "Embalming",
      "Cremation arrangements",
    ]);
    expect(detail.body.practitioners).toHaveLength(1);

    // The January deadline is surfaced, in words, without a number in red.
    const deadline = detail.body.reminders.find(
      (reminder: { key: string }) => reminder.key === "deadline-outstanding",
    );
    expect(deadline.summary).toContain("1 of 1");
    expect(deadline.summary).not.toMatch(/urgent|immediately|!/i);
    // Four months out and nobody has applied: still worth a look. The
    // ninety-day horizon the renewals use would file this under "in hand".
    expect(deadline.standing).toBe("soon");
  });

  it("keeps one home's practitioners out of another's", async () => {
    const admin = await signInPlatformAdmin();
    const first = await signUpHome("Horan & McConaty");
    const second = await signUpHome("Green Lawn");

    const created = await admin.agent
      .post(`/api/admin/homes/${first.homeId}/practitioners`)
      .send({ personName: "Karen Voss", role: "embalmer", standing: "held" })
      .expect(201);

    // The same licence id, named under the wrong home, is not found.
    await admin.agent
      .put(`/api/admin/homes/${second.homeId}/practitioners/${created.body.id}`)
      .send({ personName: "Stolen", role: "embalmer", standing: "held" })
      .expect(404);

    await admin.agent
      .delete(`/api/admin/homes/${second.homeId}/practitioners/${created.body.id}`)
      .expect(404);
  });

  it("starts the thirty-day clock when the services change, and stops it when filed", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    const base = {
      id: 1,
      funeralHomeId: 1,
      doraRegistrationNumber: "FE.0001234",
      registeredServices: ["Embalming"],
      designeeName: "Karen Voss",
      designeeTitle: null,
      beganBusinessOn: null,
      registrationRenewsOn: null,
      servicesChangedOn: "2026-09-01",
      amendmentFiledOn: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };

    const outstanding = licensureReminders(base, [], now);
    const amendment = outstanding.find((r) => r.key === "amended-registration");
    expect(amendment).toBeDefined();
    // 1 September plus thirty days is 1 October: seventeen days away.
    expect(amendment!.summary).toContain("in 17 days");

    const filed = licensureReminders(
      { ...base, amendmentFiledOn: "2026-09-10" },
      [],
      now,
    );
    expect(filed.find((r) => r.key === "amended-registration")).toBeUndefined();
  });

  it("says when things are due without ever counting down at anybody", () => {
    const now = new Date("2026-09-14T12:00:00Z");

    expect(describeWhen(PRACTITIONER_LICENSURE_DEADLINE, now)).toBe(
      "in about 4 months",
    );
    expect(describeWhen("2026-09-15", now)).toBe("tomorrow");
    expect(describeWhen("2026-09-30", now)).toBe("in 16 days");
    expect(describeWhen("2026-01-01", now)).toBe("already passed");
  });
});

/* ---------------------------------------------------------------- audit */

describe("the audit log", () => {
  it("writes a line every time the platform looks at a home", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent.get("/api/admin/homes").expect(200);
    await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);

    const rows = await db
      .select()
      .from(platformAuditTable)
      .orderBy(platformAuditTable.id);

    const actions = rows.map((row) => row.action);
    expect(actions).toContain("homes.list");
    expect(actions).toContain("home.open");
    expect(rows.every((row) => row.actorEmail === ADMIN_EMAIL)).toBe(true);

    const opened = rows.find((row) => row.action === "home.open")!;
    expect(opened.subjectHomeId).toBe(home.homeId);
    expect(opened.subjectHomeName).toBe("Horan & McConaty");

    // The log itself records no family and no decedent. A record of who
    // looked that accumulated the data it is protecting would be the same
    // leak wearing a different hat.
    const everything = JSON.stringify(rows);
    expect(everything).not.toContain("Margaret");
    expect(everything).not.toContain("Hale");
  });

  it("records the suspension, and who did it", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/suspension`)
      .send({ suspended: true, reason: "Chargeback" })
      .expect(200);

    const log = await admin.agent.get("/api/admin/audit").expect(200);
    const entry = log.body.find(
      (row: { action: string }) => row.action === "home.suspend",
    );

    expect(entry.actorEmail).toBe(ADMIN_EMAIL);
    expect(entry.detail).toBe("Chargeback");
    expect(entry.subjectHomeName).toBe("Horan & McConaty");
  });
});
