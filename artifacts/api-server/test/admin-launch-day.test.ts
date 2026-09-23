import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  usersTable,
  passwordResetsTable,
  platformAdminsTable,
  platformAuditTable,
  aftercareEnrollmentsTable,
  aftercareDeliveriesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createCase,
  inviteFamily,
  markEmailVerified,
  signUpHome,
  type StaffSession,
} from "./helpers";

/**
 * The platform console, audited as the operator on launch day.
 *
 * Two kinds of test live here. The first is a hole: the platform list names
 * email addresses, registration never checks that you own the one you type,
 * so an unconfirmed account holding a listed address walked straight in. The
 * second is the list of things an operator actually has to do on the first
 * morning -- find a home from the email address a caller gives, see why a
 * director cannot sign in and send them a link, see that mail is failing --
 * none of which the console could do.
 */

const ADMIN_EMAIL = "heather@continuumaftercare.example";
const PASSWORD = "correct-horse-battery";

async function register(email: string, homeName = "Continuum Aftercare") {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/register")
    .send({ homeName, email, password: PASSWORD })
    .expect(201);
  return { agent, homeId: res.body.home.id as number, userId: res.body.user.id as number };
}

async function signInAdmin() {
  const admin = await register(ADMIN_EMAIL);
  await markEmailVerified(ADMIN_EMAIL);
  return admin;
}

beforeEach(async () => {
  await db.insert(platformAdminsTable).values({ email: ADMIN_EMAIL });
});

/* ------------------------------------------------------------ the hole -- */

describe("who gets in", () => {
  it("refuses a listed address until it has been confirmed", async () => {
    // Somebody registers first under the address the bootstrap seeded -- the
    // ordinary state of a fresh deployment before its owner has signed up.
    const squatter = await register(ADMIN_EMAIL, "Totally Real Funeral Home");

    await squatter.agent.get("/api/admin/homes").expect(403);
    await squatter.agent.get("/api/admin/overview").expect(403);
    await squatter.agent.get("/api/admin/me").expect(403);

    // Confirming the address -- which only its real owner can do -- opens it.
    await markEmailVerified(ADMIN_EMAIL);
    await squatter.agent.get("/api/admin/me").expect(200);
  });

  it("does not let an owner mint a platform admin by inviting a listed address", async () => {
    const colleague = "new.colleague@continuumaftercare.example";
    await db.insert(platformAdminsTable).values({ email: colleague });

    const owner = await signUpHome("Anywhere Funeral Home");
    const invited = await owner.agent
      .post("/api/home/staff")
      .send({ email: colleague, role: "director" })
      .expect(201);

    // The owner is handed the invitation link on screen. Redeem it.
    const token = new URL(invited.body.inviteLink, "http://x").searchParams.get("token")!;
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: PASSWORD })
      .expect(204);

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: colleague, password: PASSWORD })
      .expect(200);

    await agent.get("/api/admin/homes").expect(403);
  });

  it("answers /admin/me for an admin without writing to the log", async () => {
    const admin = await signInAdmin();
    const res = await admin.agent.get("/api/admin/me").expect(200);
    expect(res.body).toEqual({ email: ADMIN_EMAIL });

    const log = await db.select().from(platformAuditTable);
    expect(log).toHaveLength(0);
  });
});

/* ------------------------------------------------------ finding a home -- */

describe("finding a home", () => {
  it("finds a home from a staff member's exact address, and never shows the address", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");
    await signUpHome("Olinger Chapel");

    const found = await admin.agent
      .get(`/api/admin/homes?search=${encodeURIComponent(home.email.toUpperCase())}`)
      .expect(200);

    expect(found.body.homes.map((h: { id: number }) => h.id)).toEqual([home.homeId]);
    expect(JSON.stringify(found.body)).not.toContain(home.email);

    // A fragment of an address is not a way to browse somebody's staff.
    const partial = await admin.agent
      .get(`/api/admin/homes?search=${encodeURIComponent("@example.com")}`)
      .expect(200);
    expect(partial.body.total).toBe(0);
  });

  it("treats % and _ as the characters typed, not as wildcards", async () => {
    const admin = await signInAdmin();
    await signUpHome("Horan & McConaty");

    const res = await admin.agent.get("/api/admin/homes?search=%25").expect(200);
    expect(res.body.total).toBe(0);

    const underscore = await admin.agent.get("/api/admin/homes?search=_").expect(200);
    expect(underscore.body.total).toBe(0);
  });
});

/* ------------------------------------------- a director who can't get in -- */

describe("a director who cannot sign in", () => {
  let admin: Awaited<ReturnType<typeof signInAdmin>>;
  let home: StaffSession;

  beforeEach(async () => {
    admin = await signInAdmin();
    home = await signUpHome("Horan & McConaty");
  });

  it("shows whether each person has a password and a confirmed address, but not the address", async () => {
    await home.agent
      .post("/api/home/staff")
      .send({ email: "never.finished@horan.example", displayName: "Pat", role: "director" })
      .expect(201);

    const res = await admin.agent.get(`/api/admin/homes/${home.homeId}`).expect(200);
    const byName = Object.fromEntries(
      res.body.staff.map((s: { displayName: string }) => [s.displayName, s]),
    );

    expect(byName["Karen Voss"]).toMatchObject({ hasPassword: true, emailVerified: true });
    expect(byName["Pat"]).toMatchObject({ hasPassword: false, emailVerified: false });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("@horan.example");
    expect(body).not.toContain(home.email);
    expect(body).not.toContain("passwordHash");
  });

  it("emails a reset link to the person's own inbox, logs it, and never returns the link", async () => {
    const res = await admin.agent
      .post(`/api/admin/homes/${home.homeId}/staff/${home.userId}/password-reset`)
      .expect(202);

    expect(Object.keys(res.body)).toEqual(["mailConfigured"]);
    expect(JSON.stringify(res.body)).not.toMatch(/token|reset-password/);

    const resets = await db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, home.userId));
    expect(resets).toHaveLength(1);

    const [entry] = await db.select().from(platformAuditTable);
    expect(entry).toMatchObject({
      actorEmail: ADMIN_EMAIL,
      action: "home.staff.reset",
      subjectHomeId: home.homeId,
    });
  });

  it("cannot aim a reset at somebody at another home through this home's path", async () => {
    const other = await signUpHome("Olinger Chapel");

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/staff/${other.userId}/password-reset`)
      .expect(404);

    const resets = await db.select().from(passwordResetsTable);
    expect(resets).toHaveLength(0);
  });

  it("refuses an account the home has switched off", async () => {
    await db
      .update(usersTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(usersTable.id, home.userId));

    await admin.agent
      .post(`/api/admin/homes/${home.homeId}/staff/${home.userId}/password-reset`)
      .expect(400);
  });
});

/* ------------------------------------------------- mail that is failing -- */

describe("seeing that mail is failing", () => {
  it("counts aftercare check-ins that failed to send in the last month", async () => {
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

    await db.insert(aftercareDeliveriesTable).values([
      { enrollmentId: enrollment!.id, dayOffset: 30, dueAt: new Date(), failedAt: new Date(), failureReason: "550 refused" },
      { enrollmentId: enrollment!.id, dayOffset: 60, dueAt: new Date(), sentAt: new Date() },
    ]);

    const res = await admin.agent.get("/api/admin/overview").expect(200);

    expect(res.body.delivery).toMatchObject({
      mailConfigured: false,
      aftercareFailedLast30Days: 1,
      homesWithFailures: 1,
    });
    expect(res.body.delivery.lastFailureAt).not.toBeNull();
    // The count, not whose it was.
    expect(JSON.stringify(res.body.delivery)).not.toContain("anne@");
  });
});

/* ------------------------------------------ suspension really suspends -- */

describe("suspension", () => {
  it("stops a suspended home opening cases through the CSV import too", async () => {
    const admin = await signInAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.agent
      .put(`/api/admin/homes/${home.homeId}/suspension`)
      .send({ suspended: true, reason: "Chargeback on the first invoice" })
      .expect(200);

    await home.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Hale" })
      .expect(402);

    const csv = "First Name,Last Name\nMargaret,Hale\nWalter,Hale\n";
    await home.agent
      .post("/api/cases/import")
      .attach("file", Buffer.from(csv, "utf8"), "export.csv")
      .expect(402);

    const cases = await home.agent.get("/api/cases").expect(200);
    const listed = Array.isArray(cases.body) ? cases.body : cases.body.cases;
    expect(listed).toHaveLength(0);
  });
});
