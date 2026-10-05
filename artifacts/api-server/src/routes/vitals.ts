import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  deathCertificateFilingsTable,
  vitalStatisticsTable,
} from "@workspace/db";
import {
  UpdateCertificateFilingBody,
  UpdateVitalsBody,
} from "@workspace/api-zod";
import { assertHasUpdates, badRequest, HttpError, parseBody } from "../lib/http";
import { currentUser, tenant } from "../middleware/require-auth";
import {
  encryptSsn,
  pickWritable,
  toVitalsJson,
  vitalsForCase,
} from "../lib/vitals";
import { filingForCase, toFilingJson } from "../lib/certificate-filing";
import { loadCase } from "./cases";

const router: IRouter = Router();

router.get("/cases/:caseId/vitals", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await toVitalsJson(await vitalsForCase(row.id, home.id), "staff"));
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

  res.json(await toVitalsJson(updated!, "staff"));
});

/* ------------------------------------------------- the seventy-two hours -- */

/**
 * How far ahead of the server's clock a recorded time may be.
 *
 * A director's laptop and this server disagree by seconds, and somebody
 * typing "now" into a picker rounds up to the next minute. Anything beyond
 * that is a mistyped day or month, and a custody time recorded a day late is
 * a filing deadline shown a day late -- the one error this screen exists to
 * prevent.
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

router.get("/cases/:caseId/certificate-filing", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  const filing = await filingForCase(row.id, home.id);
  res.json(await toFilingJson(filing, row, home.region));
});

router.put("/cases/:caseId/certificate-filing", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);

  // Nobody has died. There is no certificate, and recording a custody time
  // against somebody planning their own funeral would put a deadline on the
  // master page for a person who is alive.
  if (row.kind === "pre_need") {
    throw new HttpError(
      409,
      "This is a plan made in advance, so there is no death certificate to file yet.",
    );
  }

  const body = assertHasUpdates(
    parseBody(UpdateCertificateFilingBody, req.body),
  );

  const latest = Date.now() + FUTURE_TOLERANCE_MS;
  for (const [field, label] of [
    ["custodyTakenAt", "The custody time"],
    ["physicianRequestedAt", "The physician's request"],
    ["physicianCertifiedAt", "The physician's certification"],
    ["filedAt", "The filing time"],
  ] as const) {
    const value = body[field];
    if (value instanceof Date && value.getTime() > latest) {
      throw badRequest(
        `${label} is in the future. Check the date — the deadline is counted from it.`,
      );
    }
  }

  const existing = await filingForCase(row.id, home.id);

  // Who filed is recorded when a filing is, and only then. A later edit to
  // the state file number by somebody else must not re-attribute the filing.
  const filedChanged =
    body.filedAt !== undefined &&
    (body.filedAt?.getTime() ?? null) !== (existing.filedAt?.getTime() ?? null);

  const [updated] = await db
    .update(deathCertificateFilingsTable)
    .set({
      ...(body.custodyTakenAt === undefined
        ? {}
        : { custodyTakenAt: body.custodyTakenAt }),
      ...(body.physicianRequestedAt === undefined
        ? {}
        : { physicianRequestedAt: body.physicianRequestedAt }),
      ...(body.physicianCertifiedAt === undefined
        ? {}
        : { physicianCertifiedAt: body.physicianCertifiedAt }),
      ...(body.certifyingPhysician === undefined
        ? {}
        : { certifyingPhysician: body.certifyingPhysician?.trim() || null }),
      ...(filedChanged
        ? {
            filedAt: body.filedAt ?? null,
            filedByUserId: body.filedAt ? user.id : null,
          }
        : {}),
      ...(body.stateFileNumber === undefined
        ? {}
        : { stateFileNumber: body.stateFileNumber?.trim() || null }),
      updatedAt: new Date(),
    })
    .where(eq(deathCertificateFilingsTable.id, existing.id))
    .returning();

  res.json(await toFilingJson(updated!, row, home.region));
});

export default router;
