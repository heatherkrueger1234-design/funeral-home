import {
  db,
  funeralHomesTable,
  platformPlansTable,
  platformRunningCostsTable,
  type FuneralHome,
  type PlatformPlan,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { badRequest, parseBody, parseId, requireRow } from "../../lib/http";
import {
  actor,
  platformFindHomeForChange,
  recordPlatformAccess,
  toAdminHome,
} from "./shared";

/**
 * The commercial side: each home's customer record, the plans we sell, what
 * the platform costs us to run, and the financials built from all three.
 */
const router: IRouter = Router();

/* ------------------------------------------- the customer record (CRM) -- */

/**
 * Heather's own customer record for a home: the commercial relationship.
 *
 * Phase 1 §4b — the second half of the onboarding template, editable after
 * the fact. Same audit discipline as every other write here: the change is
 * logged after the checks and before the write, so a refused request never
 * leaves a line saying it happened.
 *
 * What is *not* here is deliberate. The home's own business details (name,
 * contact name, address, phone) are edited by the director on their side;
 * what lives here is what the home never sees: the plan that was sold, the
 * amount agreed, when it is due, the discount, how they heard about us, and
 * Heather's notes.
 */
const CrmBody = z.object({
  contactName: z.string().trim().max(160).nullish(),
  subscriptionPlan: z.string().trim().max(60).nullish(),
  billingPeriod: z.enum(["monthly", "annual"]).nullish(),
  billingAmountCents: z.coerce.number().int().min(0).max(100_000_000).nullish(),
  billingStartDate: z.coerce.date().nullish(),
  subscriptionDueDate: z.coerce.date().nullish(),
  discount: z.string().trim().max(200).nullish(),
  howHeardAboutUs: z.string().trim().max(200).nullish(),
  adminNotes: z.string().trim().max(4000).nullish(),
  // The template's Status field (spec §4b): trial / active / past-due /
  // canceled. "Suspended" is not set here -- suspension is its own action
  // with its own reason, on the home's page.
  subscriptionStatus: z
    .enum(["trial", "active", "past_due", "canceled"])
    .nullish(),
});

router.put("/admin/homes/:homeId/crm", async (req, res) => {
  const who = actor(req);
  const homeId = parseId(req.params.homeId);
  const values = parseBody(CrmBody, req.body);
  const home = await platformFindHomeForChange(homeId);

  // A cleared text field arrives as "" from the console; store null so a
  // cleared discount reads as "no discount" rather than an empty string.
  const updates = Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, value === "" ? null : value]),
  );

  if (Object.keys(updates).length === 0) {
    throw badRequest("Nothing to update.");
  }

  await recordPlatformAccess(
    who,
    "home.crm.update",
    home,
    "customer record updated",
  );

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  res.json(toAdminHome(updated!));
});

/* ---------------------------------------------------------- financials -- */

/**
 * The money, at a glance. Phase 1 §4c.
 *
 * "Monthly total" is the sum of the agreed amounts for homes that are
 * actually paying — active or past-due. Trials are not revenue yet, and
 * canceled or suspended homes are not revenue any more. An annual plan's
 * agreed amount is a year's charge, so it counts here as twelve monthly
 * slices (rounded), never as a month's revenue; the per-home row keeps the
 * actual agreed amount and its cadence, so nobody mistakes the normalised
 * figure for what was charged.
 *
 * Running costs are what the platform itself costs Heather each month.
 * Profit is the difference. All three figures, plus the per-home rows, are
 * what "the whole financial picture in under 30 seconds" means.
 */
function toFinancialHome(home: FuneralHome) {
  return {
    id: home.id,
    name: home.name,
    contactName: home.contactName,
    status: home.subscriptionStatus,
    plan: home.subscriptionPlan,
    billingPeriod: home.billingPeriod,
    amountChargedCents: home.billingAmountCents,
    nextDueDate: home.subscriptionDueDate,
    discount: home.discount,
    howHeardAboutUs: home.howHeardAboutUs,
    notes: home.adminNotes,
  };
}

/** What a home's agreed amount contributes to the monthly total. */
function monthlyEquivalent(home: FuneralHome): number {
  const amount = home.billingAmountCents ?? 0;
  return home.billingPeriod === "annual" ? Math.round(amount / 12) : amount;
}

router.get("/admin/financials", async (req, res) => {
  const who = actor(req);

  const homes = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.internalAccount, false))
    .orderBy(asc(funeralHomesTable.name));

  const paying = homes.filter((home) =>
    ["active", "past_due"].includes(home.subscriptionStatus),
  );
  const monthlyTotalCents = paying.reduce(
    (sum, home) => sum + monthlyEquivalent(home),
    0,
  );

  const costs = await db
    .select()
    .from(platformRunningCostsTable)
    .orderBy(asc(platformRunningCostsTable.name));
  const runningCostsCents = costs.reduce(
    (sum, cost) => sum + cost.monthlyAmountCents,
    0,
  );

  await recordPlatformAccess(
    who,
    "platform.overview",
    null,
    `financials: ${homes.length} homes`,
  );

  res.json({
    homes: homes.map(toFinancialHome),
    monthlyTotalCents,
    payingHomes: paying.length,
    runningCosts: costs.map((cost) => ({
      id: cost.id,
      name: cost.name,
      monthlyAmountCents: cost.monthlyAmountCents,
      notes: cost.notes,
    })),
    runningCostsCents,
    profitCents: monthlyTotalCents - runningCostsCents,
  });
});

const RunningCostBody = z.object({
  name: z.string().trim().min(1).max(120),
  monthlyAmountCents: z.coerce.number().int().min(0).max(100_000_000),
  notes: z.string().trim().max(1000).nullish(),
});

router.post("/admin/running-costs", async (req, res) => {
  const who = actor(req);
  const values = parseBody(RunningCostBody, req.body);

  const [cost] = await db
    .insert(platformRunningCostsTable)
    .values({
      name: values.name,
      monthlyAmountCents: values.monthlyAmountCents,
      notes: values.notes ?? null,
    })
    .returning();

  await recordPlatformAccess(
    who,
    "running-cost.create",
    null,
    `running cost added: ${cost!.name}`,
  );

  res.status(201).json(cost);
});

router.put("/admin/running-costs/:costId", async (req, res) => {
  const who = actor(req);
  const costId = parseId(req.params.costId);
  const values = parseBody(RunningCostBody.partial(), req.body);

  const updates = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(updates).length === 0) {
    throw badRequest("Nothing to update.");
  }

  const [cost] = await db
    .select()
    .from(platformRunningCostsTable)
    .where(eq(platformRunningCostsTable.id, costId))
    .limit(1);
  requireRow(cost, "That cost could not be found.");

  const [updated] = await db
    .update(platformRunningCostsTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(platformRunningCostsTable.id, costId))
    .returning();

  await recordPlatformAccess(
    who,
    "running-cost.update",
    null,
    `running cost updated: ${updated!.name}`,
  );

  res.json(updated);
});

router.delete("/admin/running-costs/:costId", async (req, res) => {
  const who = actor(req);
  const costId = parseId(req.params.costId);

  const [cost] = await db
    .select()
    .from(platformRunningCostsTable)
    .where(eq(platformRunningCostsTable.id, costId))
    .limit(1);
  requireRow(cost, "That cost could not be found.");

  await db
    .delete(platformRunningCostsTable)
    .where(eq(platformRunningCostsTable.id, costId));

  await recordPlatformAccess(
    who,
    "running-cost.delete",
    null,
    `running cost removed: ${cost!.name}`,
  );

  res.status(204).end();
});

/* --------------------------------------------------------------- plans -- */

/**
 * The subscription plans Heather sells, with their prices.
 *
 * Phase 1 §4b: "amounts configurable in settings". The onboarding template's
 * plan select reads from here; the home row records the plan name that was
 * sold (free text, so a renamed plan does not rewrite history), the billing
 * period, and the amount actually agreed.
 */

function toPlatformPlan(plan: PlatformPlan) {
  return {
    id: plan.id,
    name: plan.name,
    monthlyAmountCents: plan.monthlyAmountCents,
    annualAmountCents: plan.annualAmountCents,
  };
}

router.get("/admin/plans", async (req, res) => {
  const who = actor(req);

  const plans = await db
    .select()
    .from(platformPlansTable)
    .orderBy(asc(platformPlansTable.name));

  await recordPlatformAccess(who, "platform.overview", null, "plans listed");

  res.json({ plans: plans.map(toPlatformPlan) });
});

const PlanBody = z.object({
  name: z.string().trim().min(1).max(60),
  monthlyAmountCents: z.coerce.number().int().min(0).max(100_000_000),
  annualAmountCents: z.coerce.number().int().min(0).max(100_000_000),
});

router.post("/admin/plans", async (req, res) => {
  const who = actor(req);
  const values = parseBody(PlanBody, req.body);

  const [existing] = await db
    .select({ id: platformPlansTable.id })
    .from(platformPlansTable)
    .where(eq(platformPlansTable.name, values.name))
    .limit(1);
  if (existing) {
    throw badRequest("There is already a plan with that name.");
  }

  const [plan] = await db
    .insert(platformPlansTable)
    .values({
      name: values.name,
      monthlyAmountCents: values.monthlyAmountCents,
      annualAmountCents: values.annualAmountCents,
    })
    .returning();

  await recordPlatformAccess(
    who,
    "plan.create",
    null,
    `plan added: ${plan!.name}`,
  );

  res.status(201).json(toPlatformPlan(plan!));
});

router.put("/admin/plans/:planId", async (req, res) => {
  const who = actor(req);
  const planId = parseId(req.params.planId);
  const values = parseBody(PlanBody.partial(), req.body);

  const updates = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(updates).length === 0) {
    throw badRequest("Nothing to update.");
  }

  const [plan] = await db
    .select()
    .from(platformPlansTable)
    .where(eq(platformPlansTable.id, planId))
    .limit(1);
  requireRow(plan, "That plan could not be found.");

  if (values.name && values.name !== plan!.name) {
    const [clash] = await db
      .select({ id: platformPlansTable.id })
      .from(platformPlansTable)
      .where(eq(platformPlansTable.name, values.name))
      .limit(1);
    if (clash) {
      throw badRequest("There is already a plan with that name.");
    }
  }

  const [updated] = await db
    .update(platformPlansTable)
    .set(updates)
    .where(eq(platformPlansTable.id, planId))
    .returning();

  await recordPlatformAccess(
    who,
    "plan.update",
    null,
    `plan updated: ${updated!.name}`,
  );

  res.json(toPlatformPlan(updated!));
});

router.delete("/admin/plans/:planId", async (req, res) => {
  const who = actor(req);
  const planId = parseId(req.params.planId);

  const [plan] = await db
    .select()
    .from(platformPlansTable)
    .where(eq(platformPlansTable.id, planId))
    .limit(1);
  requireRow(plan, "That plan could not be found.");

  await db.delete(platformPlansTable).where(eq(platformPlansTable.id, planId));

  await recordPlatformAccess(
    who,
    "plan.delete",
    null,
    `plan removed: ${plan!.name}`,
  );

  res.status(204).end();
});

export default router;
