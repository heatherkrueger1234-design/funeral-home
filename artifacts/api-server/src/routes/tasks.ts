import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { runAftercare } from "@workspace/mailer/aftercare";
import { runTrialReminders } from "../lib/trial-reminders";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { runCaseMetering } from "../lib/metering";

/**
 * Scheduled work, triggered over HTTP.
 *
 * The aftercare sender used to be a script, which meant that in practice it
 * never ran: the feature a funeral home is actually paying for sent nothing
 * in production. An in-process timer is not the fix either, because this
 * deploys to an autoscale target that sleeps when idle and may run several
 * instances when it is not — a `setInterval` there fires unpredictably, or
 * four times at once.
 *
 * So the trigger is a request, and anything can make it: a scheduled
 * GitHub Actions workflow, the platform's own scheduler, a cron line on a
 * box somewhere, or a human with curl when something has gone wrong. The
 * work itself is idempotent, so an overlapping double-trigger is harmless.
 *
 * Mounted above the staff session gate and guarded by a shared secret
 * instead, because a scheduler has no cookie.
 */

const router: IRouter = Router();

/** Constant-time, so the secret cannot be recovered a character at a time. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertAuthorised(header: string | undefined): void {
  const expected = process.env["TASK_SECRET"];

  if (!expected) {
    // Refusing is the safe default. A deployment that has not set a secret
    // must not expose an unauthenticated endpoint that sends email.
    throw new HttpError(
      503,
      "Scheduled tasks are not configured on this deployment.",
    );
  }

  const match = /^Bearer\s+(.+)$/i.exec((header ?? "").trim());
  const provided = match?.[1]?.trim();

  if (!provided || !secretMatches(provided, expected)) {
    throw new HttpError(401, "Not authorised.");
  }
}

/** `?dryRun=1` reports what is due without sending or marking anything. */
function isDryRun(query: Record<string, unknown>): boolean {
  return query["dryRun"] === "1" || query["dryRun"] === "true";
}

router.post("/tasks/aftercare", async (req, res) => {
  assertAuthorised(req.headers.authorization);

  // Dry run is how you check a new deployment is wired up without writing to
  // a bereaved family.
  const result = await runAftercare({ dryRun: isDryRun(req.query) });

  logger.info({ ...result }, "Aftercare run finished");

  res.json(result);
});

/**
 * Tell homes on trial where they stand.
 *
 * A separate endpoint rather than folded into the aftercare run, because the
 * two have nothing to do with each other and failing at one must not stop the
 * other: a mail error while telling a proprietor about their bill must never
 * be the reason a widow's ninety-day check-in did not go out.
 */
router.post("/tasks/trial-reminders", async (req, res) => {
  assertAuthorised(req.headers.authorization);

  const result = await runTrialReminders({ dryRun: isDryRun(req.query) });

  logger.info({ ...result }, "Trial reminder run finished");

  res.json(result);
});

/**
 * Report counted funerals to Stripe's meter.
 *
 * Same posture as the aftercare run, and separate from it on purpose: a
 * broken meter must not stop the grief check-ins going out, and a mail
 * outage must not stop the month being invoiced. One job failing should
 * page somebody about one thing.
 *
 * Safe to run as often as you like. The rows carry an identifier Stripe
 * deduplicates on, so the worst a double trigger does is waste a request.
 */
router.post("/tasks/usage", async (req, res) => {
  assertAuthorised(req.headers.authorization);

  const result = await runCaseMetering({ dryRun: isDryRun(req.query) });

  logger.info({ ...result }, "Case metering run finished")

  res.json(result);
});

export default router;
