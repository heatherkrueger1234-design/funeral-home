import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  funeralHomesTable,
  platformAdminsTable,
  platformAuditTable,
  platformRunningCostsTable,
  usersTable,
} from "@workspace/db";
import { createPasswordReset } from "../src/lib/auth";
import { markEmailVerified } from "./helpers";

/**
 * Phase 1 §4 of the aftercare spec: the admin onboarding template, the
 * homes list, and the financials.
 *
 * What could actually go wrong here is the quiet kind: a column the
 * director should never see riding along on GET /home because it lives on
 * the same row as the ones they should, or revenue being counted for a
 * home on trial. Both are asserted from the outside, through the API.
 */

const ADMIN_EMAIL = "heather@continuumaftercare.example";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const OWNER_EMAIL = "director-onboarding@example.com";
const PASSWORD = "correct-horse-battery-staple";

async function signInPlatformAdmin() {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({
      homeName: "Continuum Aftercare",
      email: ADMIN_EMAIL,
      password: PASSWORD,
      displayName: "Heather Krueger",
    })
    .expect(201);
  await markEmailVerified(ADMIN_EMAIL);
  return agent;
}

beforeEach(async () => {
  await db.insert(platformAdminsTable).values({ email: ADMIN_EMAIL });
});

/**
 * Everything the onboarding template asks for, in one request.
 */
function fullTemplate(ownerEmail = OWNER_EMAIL) {
  return {
    name: "Horan & McConaty",
    contactName: "Karen Voss",
    ownerEmail,
    addressLine1: "11150 E Dartmouth Ave",
    city: "Aurora",
    region: "CO",
    postalCode: "80014",
    phone: "303-555-0100",
    timezone: "America/Denver",
    subscriptionPlan: "Standard",
    billingPeriod: "monthly",
    billingAmountCents: 4900,
    billingStartDate: "2026-09-01",
    subscriptionDueDate: "2026-10-01",
    discount: "20% off the first year",
    howHeardAboutUs: "Referral from another home",
    adminNotes: "Met at the state conference.",
  };
}

async function createHome(
  admin: ReturnType<typeof request.agent>,
  body = fullTemplate(),
) {
  const res = await admin.post("/api/admin/homes").send(body).expect(201);
  return res.body as { id: number; name: string; mailSent: boolean };
}

/**
 * The owner chooses a password from the invitation and signs in, the way a
 * real invitee would. The emailed token is hashed in the database, so the
 * test issues its own invitation token the same way the server does.
 */
async function signInAsOwner(homeId: number) {
  const [owner] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, OWNER_EMAIL));
  expect(owner).toBeDefined();
  expect(owner!.funeralHomeId).toBe(homeId);

  const token = await createPasswordReset(owner!.id, 7 * 24 * 60 * 60 * 1000);
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token, password: "a-long-owner-password" })
    .expect(204);
  await markEmailVerified(OWNER_EMAIL);

  const agent = request.agent(app);
  await agent
    .post("/api/auth/login")
    .send({ email: OWNER_EMAIL, password: "a-long-owner-password" })
    .expect(200);
  return agent;
}

/** Fields that are Heather's customer record, not the home's own data. */
const ADMIN_ONLY = [
  "subscriptionPlan",
  "billingPeriod",
  "billingAmountCents",
  "billingStartDate",
  "subscriptionDueDate",
  "discount",
  "howHeardAboutUs",
  "adminNotes",
];

describe("the onboarding template", () => {
  it("persists everything Heather entered when the home is provisioned", async () => {
    const admin = await signInPlatformAdmin();
    const created = await createHome(admin);

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, created.id));
    expect(row).toBeDefined();
    expect(row!.name).toBe("Horan & McConaty");
    expect(row!.contactName).toBe("Karen Voss");
    expect(row!.city).toBe("Aurora");
    expect(row!.postalCode).toBe("80014");
    expect(row!.phone).toBe("303-555-0100");
    expect(row!.subscriptionPlan).toBe("Standard");
    expect(row!.billingPeriod).toBe("monthly");
    expect(row!.billingAmountCents).toBe(4900);
    expect(row!.discount).toBe("20% off the first year");
    expect(row!.howHeardAboutUs).toBe("Referral from another home");
    expect(row!.adminNotes).toBe("Met at the state conference.");
  });

  it("creates the owner account with an invitation, not a password", async () => {
    const admin = await signInPlatformAdmin();
    const created = await createHome(admin);

    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, OWNER_EMAIL));
    expect(owner).toBeDefined();
    expect(owner!.funeralHomeId).toBe(created.id);
    expect(owner!.role).toBe("owner");
    // No temporary password is generated or revealed: the invitation is the
    // credential, and the director chooses their own password from it.
    expect(owner!.passwordHash).toBeNull();
  });

  it("validates the template: bad money, bad period, bad dates are refused", async () => {
    const admin = await signInPlatformAdmin();

    await admin
      .post("/api/admin/homes")
      .send({ ...fullTemplate(), billingAmountCents: -100 })
      .expect(400);
    await admin
      .post("/api/admin/homes")
      .send({ ...fullTemplate(), billingPeriod: "quarterly" })
      .expect(400);
    await admin
      .post("/api/admin/homes")
      .send({ ...fullTemplate(), subscriptionDueDate: "next tuesday" })
      .expect(400);
  });

  it("a director sees their own business info, and none of Heather's commercial record", async () => {
    const admin = await signInPlatformAdmin();
    const created = await createHome(admin);
    const director = await signInAsOwner(created.id);

    const res = await director.get("/api/home").expect(200);

    // Their own business details, from the template.
    expect(res.body.name).toBe("Horan & McConaty");
    expect(res.body.contactName).toBe("Karen Voss");
    expect(res.body.city).toBe("Aurora");
    expect(res.body.phone).toBe("303-555-0100");

    // Heather's side of the commercial relationship stays with Heather.
    for (const field of ADMIN_ONLY) {
      expect(res.body).not.toHaveProperty(field);
    }
  });

  it("a director can update their contact person; the response stays commercial-free", async () => {
    const admin = await signInPlatformAdmin();
    const created = await createHome(admin);
    const director = await signInAsOwner(created.id);

    const res = await director
      .put("/api/home")
      .send({ contactName: "Priya Nair" })
      .expect(200);

    expect(res.body.contactName).toBe("Priya Nair");
    for (const field of ADMIN_ONLY) {
      expect(res.body).not.toHaveProperty(field);
    }

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, created.id));
    expect(row!.contactName).toBe("Priya Nair");
  });

  it("Heather can revise the commercial record, and the revision is audited", async () => {
    const admin = await signInPlatformAdmin();
    const created = await createHome(admin);

    await admin
      .put(`/api/admin/homes/${created.id}/crm`)
      .send({
        subscriptionStatus: "active",
        billingPeriod: "annual",
        discount: "Loyalty rate: $40/mo",
        adminNotes: "Called to thank them.",
        // Clearing a field sends ""; it is stored as null, not "".
        howHeardAboutUs: "",
      })
      .expect(200);

    const [row] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, created.id));
    expect(row!.subscriptionStatus).toBe("active");
    expect(row!.billingPeriod).toBe("annual");
    expect(row!.discount).toBe("Loyalty rate: $40/mo");
    expect(row!.adminNotes).toBe("Called to thank them.");
    expect(row!.howHeardAboutUs).toBeNull();
    // Fields not sent are left alone.
    expect(row!.billingAmountCents).toBe(4900);

    const entries = await db
      .select()
      .from(platformAuditTable)
      .where(eq(platformAuditTable.subjectHomeId, created.id));
    expect(entries.some((e) => e.action === "home.crm.update")).toBe(true);
  });
});

describe("the financials", () => {
  async function seedFinancials() {
    const admin = await signInPlatformAdmin();
    const paying = await createHome(admin, fullTemplate("paying@example.com"));
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active" })
      .where(eq(funeralHomesTable.id, paying.id));

    const annual = await createHome(admin, {
      ...fullTemplate("annual@example.com"),
      name: "Annual Home",
      billingPeriod: "annual",
      billingAmountCents: 48000,
    });
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active" })
      .where(eq(funeralHomesTable.id, annual.id));

    const trial = await createHome(admin, {
      ...fullTemplate("trial@example.com"),
      name: "Trial Home",
      billingAmountCents: 9900,
    });

    const canceled = await createHome(admin, {
      ...fullTemplate("canceled@example.com"),
      name: "Canceled Home",
      billingAmountCents: 7900,
    });
    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "canceled" })
      .where(eq(funeralHomesTable.id, canceled.id));

    return admin;
  }

  it("counts only homes that are actually paying in the monthly total", async () => {
    const admin = await seedFinancials();
    const res = await admin.get("/api/admin/financials").expect(200);

    expect(res.body.payingHomes).toBe(2);
    // The monthly home counts in full; the annual home's $480 counts as
    // $40 — a twelfth — never as a month's revenue.
    expect(res.body.monthlyTotalCents).toBe(4900 + 4000);

    // Every home still appears in the per-home table, with its status, so a
    // canceled home's amount is visible without being counted as revenue.
    const byName = Object.fromEntries(
      res.body.homes.map((h: { name: string }) => [h.name, h]),
    );
    expect(byName["Horan & McConaty"].status).toBe("active");
    expect(byName["Annual Home"].status).toBe("active");
    expect(byName["Annual Home"].billingPeriod).toBe("annual");
    expect(byName["Annual Home"].amountChargedCents).toBe(48000);
    expect(byName["Trial Home"].status).toBe("trial");
    expect(byName["Canceled Home"].status).toBe("canceled");
    expect(byName["Canceled Home"].amountChargedCents).toBe(7900);
  });

  it("manages running costs, and profit is revenue minus costs", async () => {
    const admin = await seedFinancials();
    // $49/mo home + $480/yr home counted as $40/mo.
    const revenue = 4900 + 4000;

    const created = await admin
      .post("/api/admin/running-costs")
      .send({ name: "Hosting", monthlyAmountCents: 1200 })
      .expect(201);

    let financials = await admin.get("/api/admin/financials").expect(200);
    expect(financials.body.runningCostsCents).toBe(1200);
    expect(financials.body.profitCents).toBe(revenue - 1200);

    await admin
      .put(`/api/admin/running-costs/${created.body.id}`)
      .send({ name: "Hosting", monthlyAmountCents: 1500 })
      .expect(200);

    financials = await admin.get("/api/admin/financials").expect(200);
    expect(financials.body.runningCostsCents).toBe(1500);
    expect(financials.body.profitCents).toBe(revenue - 1500);

    await admin
      .delete(`/api/admin/running-costs/${created.body.id}`)
      .expect(204);

    financials = await admin.get("/api/admin/financials").expect(200);
    expect(financials.body.runningCostsCents).toBe(0);
    expect(financials.body.profitCents).toBe(revenue);
  });

  it("refuses bad running costs", async () => {
    const admin = await signInPlatformAdmin();
    await admin
      .post("/api/admin/running-costs")
      .send({ name: "", monthlyAmountCents: 100 })
      .expect(400);
    await admin
      .post("/api/admin/running-costs")
      .send({ name: "Hosting", monthlyAmountCents: -50 })
      .expect(400);
  });

  it("audits running-cost writes under their own actions", async () => {
    const admin = await signInPlatformAdmin();
    const created = await admin
      .post("/api/admin/running-costs")
      .send({ name: "Hosting", monthlyAmountCents: 1200 })
      .expect(201);
    await admin
      .put(`/api/admin/running-costs/${created.body.id}`)
      .send({ name: "Hosting", monthlyAmountCents: 1300 })
      .expect(200);
    await admin
      .delete(`/api/admin/running-costs/${created.body.id}`)
      .expect(204);

    const entries = await db.select().from(platformAuditTable);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("running-cost.create");
    expect(actions).toContain("running-cost.update");
    expect(actions).toContain("running-cost.delete");
  });

  it("keeps the plan price list Heather sells from", async () => {
    const admin = await signInPlatformAdmin();

    const created = await admin
      .post("/api/admin/plans")
      .send({
        name: "Standard",
        monthlyAmountCents: 4900,
        annualAmountCents: 49000,
      })
      .expect(201);
    expect(created.body.name).toBe("Standard");

    // Names are unique: two "Standard" plans would make the onboarding
    // select meaningless.
    await admin
      .post("/api/admin/plans")
      .send({
        name: "Standard",
        monthlyAmountCents: 9900,
        annualAmountCents: 99000,
      })
      .expect(400);

    await admin
      .put(`/api/admin/plans/${created.body.id}`)
      .send({ annualAmountCents: 46800 })
      .expect(200);

    const listed = await admin.get("/api/admin/plans").expect(200);
    expect(listed.body.plans).toHaveLength(1);
    expect(listed.body.plans[0].annualAmountCents).toBe(46800);

    await admin.delete(`/api/admin/plans/${created.body.id}`).expect(204);
    const gone = await admin.get("/api/admin/plans").expect(200);
    expect(gone.body.plans).toHaveLength(0);

    const entries = await db.select().from(platformAuditTable);
    const actions = entries.map((e) => e.action);
    expect(actions).toContain("plan.create");
    expect(actions).toContain("plan.update");
    expect(actions).toContain("plan.delete");
  });
});
