import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vitalStatisticsTable } from "@workspace/db";
import { UpdateVitalsBody } from "@workspace/api-zod";
import { assertHasUpdates, badRequest, notFound, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  encryptSsn,
  pickWritable,
  readSsn,
  toVitalsJson,
  vitalsForCase,
} from "../lib/vitals";
import { logger } from "../lib/logger";
import { loadCase } from "./cases";

const router: IRouter = Router();

router.get("/cases/:caseId/vitals", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await toVitalsJson(await vitalsForCase(row.id, home.id)));
});

router.put("/cases/:caseId/vitals", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await vitalsForCase(row.id, home.id);

  const body = assertHasUpdates(parseBody(UpdateVitalsBody, req.body));
  const values = pickWritable(body as Record<string, unknown>);

  const touchedSsn = Object.prototype.hasOwnProperty.call(
    body,
    "socialSecurityNumber",
  );

  if (touchedSsn) {
    const digits = (body.socialSecurityNumber ?? "").replace(/\D/g, "");
    if (digits.length > 0 && digits.length !== 9) {
      throw badRequest("A social security number has nine digits.");
    }
  }

  const [updated] = await db
    .update(vitalStatisticsTable)
    .set({
      ...values,
      ...(touchedSsn
        ? { socialSecurityNumber: encryptSsn(body.socialSecurityNumber) }
        : {}),
      ...(body.staffNotes === undefined ? {} : { staffNotes: body.staffNotes }),
      ...(body.verified === undefined
        ? {}
        : body.verified
          ? { status: "verified", verifiedAt: new Date(), verifiedByUserId: user.id }
          : { status: "collecting", verifiedAt: null, verifiedByUserId: null }),
      updatedAt: new Date(),
    })
    .where(eq(vitalStatisticsTable.id, existing.id))
    .returning();

  res.json(await toVitalsJson(updated!));
});

/**
 * The number itself, once, with a name against it.
 *
 * Everywhere else an SSN appears in this application it is masked, and for a
 * long time that included here — which made the field write-only. A family
 * gave their mother's social security number, were told the certificate
 * needed it, and the home then had to ring them back and ask again. Masking
 * a number from the people whose job is to file it does not protect anybody.
 *
 * Three things keep this honest:
 *
 *  - It is a POST with nothing in the path, so the request never lands in
 *    browser history, an access log or a cache key.
 *  - The response is the only one in this API with `Cache-Control: no-store`,
 *    because a nine-digit number sitting in a disk cache outlives the tab.
 *  - Every call is stamped on the row and written to the log without the
 *    number in it. That is a record, not a gate: anybody who can open the
 *    case can press the button, and what the home gains is being able to
 *    answer who looked, and when.
 */
router.post("/cases/:caseId/vitals/social-security-number", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);

  const vitals = await vitalsForCase(row.id, home.id);
  const number = readSsn(vitals.socialSecurityNumber);

  if (!number) {
    throw notFound("No social security number has been given for this case.");
  }

  const revealedAt = new Date();

  await db
    .update(vitalStatisticsTable)
    .set({
      ssnRevealedAt: revealedAt,
      ssnRevealedByUserId: user.id,
      updatedAt: revealedAt,
    })
    .where(eq(vitalStatisticsTable.id, vitals.id));

  // The fact, never the number.
  logger.info(
    { caseId: row.id, userId: user.id, homeId: home.id },
    "Social security number revealed to staff",
  );

  res.setHeader("Cache-Control", "no-store");
  res.json({
    socialSecurityNumber: number,
    revealedAt,
    revealedByName: user.displayName ?? null,
  });
});

export default router;
