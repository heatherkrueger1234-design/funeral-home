import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { isMailConfigured } from "@workspace/mailer";
import { isSmsConfigured } from "../lib/sms";

const router: IRouter = Router();

/**
 * Liveness that actually checks something.
 *
 * A process can be listening and still be useless: if Postgres is
 * unreachable, every screen in both apps returns an error. A health check
 * that answers "ok" to that keeps a broken instance in the load balancer,
 * which is worse than having no health check at all.
 *
 * Mail and SMS are reported but never fail the check. A home without Twilio
 * is a home whose directors copy links by hand -- degraded, not down -- and
 * taking the deployment out of rotation over it would turn a minor
 * inconvenience into an outage.
 */
router.get("/healthz", async (_req, res) => {
  let database = true;

  try {
    await db.execute(sql`select 1`);
  } catch {
    database = false;
  }

  res.status(database ? 200 : 503).json({
    status: database ? "ok" : "degraded",
    database,
    mail: isMailConfigured(),
    sms: isSmsConfigured(),
  });
});

export default router;
