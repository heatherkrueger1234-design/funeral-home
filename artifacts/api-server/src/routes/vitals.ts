import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, vitalStatisticsTable } from "@workspace/db";
import { UpdateVitalsBody } from "@workspace/api-zod";
import { assertHasUpdates, badRequest, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  encryptSsn,
  pickWritable,
  toVitalsJson,
  vitalsForCase,
} from "../lib/vitals";
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

export default router;
