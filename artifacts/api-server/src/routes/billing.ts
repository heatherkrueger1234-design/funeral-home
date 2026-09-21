import { Router, type IRouter } from "express";
import express from "express";
import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  billableCasesTable,
  funeralHomesTable,
  homeGroupsTable,
  ADD_ONS,
  ONBOARDING_STEPS,
  canOpenCases,
  hasAddOn,
  isAddOnKey,
  trialDaysLeft,
  type AddOnKey,
  type FuneralHome,
} from "@workspace/db";
import { StartCheckoutBody, CompleteOnboardingStepBody } from "@workspace/api-zod";
import { badRequest, HttpError, parseBody } from "../lib/http";
import { logger } from "../lib/logger";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  applySubscription,
  createCheckoutSession,
  createPortalSession,
  isBillingConfigured,
  verifyWebhook,
} from "../lib/billing";

/**
 * Two routers, because they need opposite things.
 *
 * The webhook is unauthenticated by necessity and needs the raw body; the
 * rest needs a staff session. They were one router with `router.use(requireAuth)`
 * in the middle, which is a trap: a sub-router mounted at the root applies
 * its middleware to every request that passes through it, so that one line
 * quietly put a session gate in front of the whole API. Splitting them makes
 * the two postures impossible to confuse.
 */
export const billingWebhookRouter: IRouter = Router();

const router: IRouter = Router();

/**
 * The webhook, mounted before the session gate and before the JSON body
 * parser.
 *
 * Stripe signs the exact bytes it sent, so the signature can only be checked
 * against a raw body — `express.json()` would have already turned it into an
 * object and thrown the original away. This is the one route in the codebase
 * that needs the raw buffer, which is why it carries its own parser.
 *
 * Unauthenticated by necessity: Stripe has no session. The signature is the
 * only thing between a stranger and marking their own home as paid, so a
 * request that fails verification is refused without being read.
 */
billingWebhookRouter.post(
  "/billing/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const event = await verifyWebhook(
      req.body as Buffer,
      req.headers["stripe-signature"] as string | undefined,
    );

    if (!event) {
      throw new HttpError(400, "Signature verification failed.");
    }

    const { type, data } = event as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    // Only the events that change whether the app should let a home work.
    // Invoices, receipts and payment methods are Stripe's to keep.
    if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      await applySubscription(data.object as never);
    } else {
      logger.debug({ type }, "Ignoring a Stripe event we do not act on");
    }

    // Always 200 once verified. A non-2xx makes Stripe retry for days, and
    // an event we chose not to act on is not a failure.
    res.json({ received: true });
  },
);

/* ------------------------------------------------------ signed-in surface */

/**
 * How many funerals have been counted against this home this month.
 *
 * Shown because the per-case charge is the one part of the bill that moves,
 * and a number that moves and cannot be checked is how a customer ends up
 * ringing their bookkeeper instead of us. A director should be able to see
 * the count the same day the funeral happened, not four weeks later on an
 * invoice.
 *
 * It is a **count, not a bill**, and the response says so in that many
 * words. The arithmetic belongs to Stripe -- this endpoint has never seen a
 * price and must never learn one, or there are two answers to what a home
 * owes and the wrong one is the one with the friendlier user interface.
 */
async function caseCountsFor(funeralHomeId: number) {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({
      billableThisMonth: count(
        sql`case when ${billableCasesTable.waivedReason} is null then 1 end`,
      ),
      waivedThisMonth: count(
        sql`case when ${billableCasesTable.waivedReason} is not null then 1 end`,
      ),
    })
    .from(billableCasesTable)
    .where(
      and(
        eq(billableCasesTable.funeralHomeId, funeralHomeId),
        gte(billableCasesTable.countedAt, startOfMonth),
      ),
    );

  return {
    since: startOfMonth,
    billableThisMonth: row?.billableThisMonth ?? 0,
    waivedThisMonth: row?.waivedThisMonth ?? 0,
    note: "A count of funerals, not a bill. Your invoice is Stripe's.",
  };
}

function toBillingJson(
  home: FuneralHome,
  extras?: {
    cases?: Awaited<ReturnType<typeof caseCountsFor>>;
    group?: { id: number; name: string } | null;
  },
) {
  const done = new Set(
    home.onboardingDone.split(",").map((step) => step.trim()).filter(Boolean),
  );

  const onboarding = ONBOARDING_STEPS.map((step) => ({
    key: step.key,
    title: step.title,
    detail: step.detail,
    done: done.has(step.key),
  }));

  const addOns = ADD_ONS.map((addOn) => ({
    key: addOn.key,
    title: addOn.title,
    detail: addOn.detail,
    included: hasAddOn(home, addOn.key),
  }));

  return {
    addOns,
    /**
     * Null for a home that pays its own bill, which is most of them. When it
     * is set, the contract belongs to the group and this console cannot
     * change it -- see the guard on the checkout route.
     */
    group: extras?.group ?? null,
    cases: extras?.cases,
    subscriptionStatus: home.subscriptionStatus,
    trialEndsAt: home.trialEndsAt,
    trialDaysLeft: trialDaysLeft(home),
    currentPeriodEndsAt: home.currentPeriodEndsAt,
    canOpenCases: canOpenCases(home),
    billingConfigured: isBillingConfigured(),
    hasSubscription: home.stripeSubscriptionId !== null,
    onboarding,
    onboardingComplete: onboarding.every((step) => step.done),
  };
}

router.get("/billing", async (req, res) => {
  const home = tenant(req);

  const [cases, group] = await Promise.all([
    caseCountsFor(home.id),
    groupFor(home),
  ]);

  res.json(toBillingJson(home, { cases, group }));
});

/** The group's name, for a location that belongs to one. Nothing else. */
async function groupFor(
  home: FuneralHome,
): Promise<{ id: number; name: string } | null> {
  if (home.groupId === null) return null;

  const [group] = await db
    .select({ id: homeGroupsTable.id, name: homeGroupsTable.name })
    .from(homeGroupsTable)
    .where(eq(homeGroupsTable.id, home.groupId))
    .limit(1);

  return group ?? null;
}

function assertOwner(role: string): void {
  if (role !== "owner") {
    throw new HttpError(403, "Only an owner can change billing.");
  }
}

/**
 * A location inside a group does not buy its own subscription.
 *
 * Refused rather than quietly allowed, because the quiet version is a group
 * that gets one consolidated invoice plus a second, separate charge for the
 * Denver branch, discovered by their accounts department a quarter later.
 * The message names who to talk to instead of implying something is broken.
 */
function assertNotInGroup(home: FuneralHome): void {
  if (home.groupId !== null) {
    throw new HttpError(
      409,
      "This location is billed through your group's contract. Whoever " +
        "manages that account can change it; nothing is charged here.",
    );
  }
}

const AddOnSelection = z.object({
  addOns: z.array(z.string().refine(isAddOnKey)).optional(),
});

router.post("/billing/checkout", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  assertOwner(user.role);

  // Asked before the deployment question, because it is the more specific
  // answer and it is true either way: this location does not buy its own
  // subscription, whether or not Stripe is wired up here.
  assertNotInGroup(home);

  if (!isBillingConfigured()) {
    throw badRequest(
      "Billing is not set up on this deployment. Nothing is being charged.",
    );
  }

  const { returnUrl } = parseBody(StartCheckoutBody, req.body);
  // Parsed separately from the generated body schema, which is regenerated
  // from `openapi.yaml` and does not know about add-ons yet.
  const { addOns } = AddOnSelection.parse(req.body ?? {});

  res.json({
    url: await createCheckoutSession({
      home,
      email: user.email,
      returnUrl,
      addOns: addOns as AddOnKey[] | undefined,
    }),
  });
});

router.post("/billing/portal", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  assertOwner(user.role);

  // Same reasoning as checkout, and it matters more here: Stripe's portal
  // can cancel a subscription, and one location must not be able to cancel
  // the contract covering the other thirty-nine.
  assertNotInGroup(home);

  if (!isBillingConfigured()) {
    throw badRequest("Billing is not set up on this deployment.");
  }

  const { returnUrl } = parseBody(StartCheckoutBody, req.body);

  res.json({
    url: await createPortalSession({ home, email: user.email, returnUrl }),
  });
});

/**
 * Tick off a setup step.
 *
 * Steps are also ticked automatically when the thing actually happens — see
 * `markOnboarding` — so this exists for the ones a director wants to dismiss
 * and for undoing a mistake.
 */
router.post("/home/onboarding", async (req, res) => {
  const home = tenant(req);
  const { step, done } = parseBody(CompleteOnboardingStepBody, req.body);

  if (!ONBOARDING_STEPS.some((entry) => entry.key === step)) {
    throw badRequest("That is not a setup step.");
  }

  const current = new Set(
    home.onboardingDone.split(",").map((entry) => entry.trim()).filter(Boolean),
  );

  if (done === false) current.delete(step);
  else current.add(step);

  const [updated] = await db
    .update(funeralHomesTable)
    .set({ onboardingDone: [...current].join(","), updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  const [cases, group] = await Promise.all([
    caseCountsFor(home.id),
    groupFor(updated!),
  ]);

  res.json(toBillingJson(updated!, { cases, group }));
});

export default router;
