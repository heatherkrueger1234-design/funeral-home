import { Router, type IRouter } from "express";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import {
  db,
  casesTable,
  deathCertificateFilingsTable,
  usersTable,
  vitalStatisticsTable,
  certificateDueAt,
  certificationDueAt,
  decedentDisplayName,
  CERTIFICATE_FILING_NOTICE,
  type DeathCertificateFiling,
} from "@workspace/db";
import { UpdateDeathCertificateBody } from "@workspace/api-zod";
import { assertHasUpdates, parseBody } from "../lib/http";
import { missingForFiling } from "../lib/vitals";
import { currentUser, tenant } from "../middleware/require-auth";
import { loadCase } from "./cases";

/**
 * The 72-hour certificate clock, staff only. The family portal never shows
 * a countdown: right for a director, wrong for a widow.
 */
const router: IRouter = Router();

/** Created on first read, so no caller handles a missing record. */
async function certificateFor(caseId: number, funeralHomeId: number): Promise<DeathCertificateFiling> {
  const where = and(
    eq(deathCertificateFilingsTable.caseId, caseId),
    eq(deathCertificateFilingsTable.funeralHomeId, funeralHomeId),
  );
  const [existing] = await db.select().from(deathCertificateFilingsTable).where(where).limit(1);
  if (existing) return existing;

  await db
    .insert(deathCertificateFilingsTable)
    .values({ funeralHomeId, caseId })
    .onConflictDoNothing({ target: deathCertificateFilingsTable.caseId });
  const [created] = await db.select().from(deathCertificateFilingsTable).where(where).limit(1);
  return created!;
}

export async function certificateJson(row: DeathCertificateFiling, now = new Date()) {
  const dueAt = certificateDueAt(row);
  const [filer] = row.filedByUserId
    ? await db
        .select({ name: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, row.filedByUserId))
        .limit(1)
    : [];
  const [vitals] = await db
    .select()
    .from(vitalStatisticsTable)
    .where(eq(vitalStatisticsTable.caseId, row.caseId))
    .limit(1);

  return {
    custodyTakenAt: row.custodyTakenAt,
    dueAt,
    hoursRemaining:
      dueAt && !row.filedAt
        ? Math.round(((dueAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10
        : null,
    edrsRequestedAt: row.edrsRequestedAt,
    certificationDueAt: certificationDueAt(row),
    certifyingProvider: row.certifyingProvider,
    certifiedAt: row.certifiedAt,
    filedAt: row.filedAt,
    filedByName: filer?.name ?? null,
    stateFileNumber: row.stateFileNumber,
    notes: row.notes,
    // What the vital statistics still lack before it can be filed.
    missingVitals: vitals ? missingForFiling(vitals) : null,
    filingNotice: CERTIFICATE_FILING_NOTICE,
  };
}

router.get("/cases/:caseId/certificate", async (req, res) => {
  const home = tenant(req);
  const row = await loadCase(req, req.params.caseId);
  res.json(await certificateJson(await certificateFor(row.id, home.id)));
});

router.put("/cases/:caseId/certificate", async (req, res) => {
  const home = tenant(req);
  const user = currentUser(req);
  const row = await loadCase(req, req.params.caseId);
  const existing = await certificateFor(row.id, home.id);
  const body = assertHasUpdates(parseBody(UpdateDeathCertificateBody, req.body));
  const text = (value: string | null | undefined) =>
    value === undefined ? undefined : value?.trim() || null;

  const [updated] = await db
    .update(deathCertificateFilingsTable)
    .set({
      ...(body.custodyTakenAt !== undefined ? { custodyTakenAt: body.custodyTakenAt } : {}),
      ...(body.edrsRequestedAt !== undefined ? { edrsRequestedAt: body.edrsRequestedAt } : {}),
      ...(body.certifiedAt !== undefined ? { certifiedAt: body.certifiedAt } : {}),
      ...(body.certifyingProvider !== undefined
        ? { certifyingProvider: text(body.certifyingProvider) }
        : {}),
      ...(body.stateFileNumber !== undefined ? { stateFileNumber: text(body.stateFileNumber) } : {}),
      ...(body.notes !== undefined ? { notes: text(body.notes) } : {}),
      ...(body.filed === undefined
        ? {}
        : body.filed
          ? { filedAt: existing.filedAt ?? new Date(), filedByUserId: existing.filedByUserId ?? user.id }
          : { filedAt: null, filedByUserId: null }),
      updatedAt: new Date(),
    })
    .where(eq(deathCertificateFilingsTable.id, existing.id))
    .returning();

  res.json(await certificateJson(updated!));
});

/**
 * Open cases whose certificate clock is running and not yet filed, soonest
 * due first. For the dashboard.
 */
export async function certificatesRunning(funeralHomeId: number, now = new Date()) {
  const rows = await db
    .select({
      filing: deathCertificateFilingsTable,
      decedentFirstName: casesTable.decedentFirstName,
      decedentLastName: casesTable.decedentLastName,
      decedentPreferredName: casesTable.decedentPreferredName,
    })
    .from(deathCertificateFilingsTable)
    .innerJoin(casesTable, eq(casesTable.id, deathCertificateFilingsTable.caseId))
    .where(
      and(
        eq(deathCertificateFilingsTable.funeralHomeId, funeralHomeId),
        isNotNull(deathCertificateFilingsTable.custodyTakenAt),
        isNull(deathCertificateFilingsTable.filedAt),
        ne(casesTable.status, "closed"),
      ),
    )
    .orderBy(asc(deathCertificateFilingsTable.custodyTakenAt))
    .limit(8);

  return rows.map((row) => {
    const dueAt = certificateDueAt(row.filing)!;
    return {
      caseId: row.filing.caseId,
      decedentName: decedentDisplayName(row),
      dueAt,
      hoursRemaining: Math.round(((dueAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10,
    };
  });
}

export default router;
