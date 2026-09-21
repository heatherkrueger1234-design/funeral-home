import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { runAftercare } from "@workspace/mailer/aftercare";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

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

router.post("/tasks/aftercare", async (req, res) => {
  assertAuthorised(req.headers.authorization);

  // `?dryRun=1` reports what is due without sending or marking anything,
  // which is how you check a new deployment is wired up without writing to
  // a bereaved family.
  const dryRun = req.query["dryRun"] === "1" || req.query["dryRun"] === "true";

  const result = await runAftercare({ dryRun });

  logger.info({ ...result }, "Aftercare run finished");

  res.json(result);
});

export default router;
