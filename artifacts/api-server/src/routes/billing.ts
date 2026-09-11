import { Router, type IRouter } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  ONBOARDING_STEPS,
  canOpenCases,
  trialDaysLeft,
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

function toBillingJson(home: FuneralHome) {
  const done = new Set(
    home.onboardingDone.split(",").map((step) => step.trim()).filter(Boolean),
  );

  const onboarding = ONBOARDING_STEPS.map((step) => ({
    key: step.key,
    title: step.title,
    detail: step.detail,
    done: done.has(step.key),
  }));

  return {
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

router.get("/billing", (req, res) => {
  res.json(toBillingJson(tenant(req)));
});

function assertOwner(role: string): void {
  if (role !== "owner") {
    throw new HttpError(403, "Only an owner can change billing.");
  }
}

router.post("/billing/checkout", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  assertOwner(user.role);

  if (!isBillingConfigured()) {
    throw badRequest(
      "Billing is not set up on this deployment. Nothing is being charged.",
    );
  }

  const { returnUrl } = parseBody(StartCheckoutBody, req.body);

  res.json({
    url: await createCheckoutSession({ home, email: user.email, returnUrl }),
  });
});

router.post("/billing/portal", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  assertOwner(user.role);

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

  res.json(toBillingJson(updated!));
});

export default router;
