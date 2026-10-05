import { and, eq } from "drizzle-orm";
import {
  db,
  deathCertificateFilingsTable,
  usersTable,
  certificateDueAt,
  filingWindowHours,
  homeStateCode,
  physicianDueAt,
  type Case,
  type DeathCertificateFiling,
} from "@workspace/db";

/**
 * The death certificate's clock, as the console reads it.
 *
 * Everything here is arithmetic on times a director typed. Nothing is
 * fetched from the state, nothing is submitted to it, and `standing` is a
 * description of the home's own record rather than a claim about what the
 * registrar has received.
 */

/** Created on first read, so no caller has to handle a missing record. */
export async function filingForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<DeathCertificateFiling> {
  const [existing] = await db
    .select()
    .from(deathCertificateFilingsTable)
    .where(
      and(
        eq(deathCertificateFilingsTable.caseId, caseId),
        eq(deathCertificateFilingsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(deathCertificateFilingsTable)
    .values({ funeralHomeId, caseId })
    .onConflictDoNothing({ target: deathCertificateFilingsTable.caseId })
    .returning();

  if (created) return created;

  // Lost a race with another tab opening the same case.
  const [raced] = await db
    .select()
    .from(deathCertificateFilingsTable)
    .where(eq(deathCertificateFilingsTable.caseId, caseId))
    .limit(1);

  return raced!;
}

export type FilingStanding =
  | "not_applicable"
  | "no_custody"
  | "open"
  | "past_due"
  | "filed";

/**
 * Where the record stands at `now`.
 *
 * A pre-need file comes first because nothing else applies to it: the
 * person is alive. Filed comes before any arithmetic, because a certificate
 * filed late is still filed and the console should stop pointing at it.
 */
export function filingStanding(
  filing: Pick<DeathCertificateFiling, "custodyTakenAt" | "filedAt">,
  kind: Case["kind"],
  dueAt: Date | null,
  now: Date,
): FilingStanding {
  if (kind === "pre_need") return "not_applicable";
  if (filing.filedAt !== null) return "filed";
  if (filing.custodyTakenAt === null) return "no_custody";
  if (dueAt !== null && dueAt.getTime() < now.getTime()) return "past_due";
  return "open";
}

export async function toFilingJson(
  filing: DeathCertificateFiling,
  row: Pick<Case, "id" | "kind">,
  region: string | null,
  now: Date = new Date(),
) {
  const dueAt = certificateDueAt(filing.custodyTakenAt, region);

  let filedByName: string | null = null;
  if (filing.filedByUserId !== null) {
    const [user] = await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, filing.filedByUserId))
      .limit(1);
    filedByName = user?.displayName ?? null;
  }

  return {
    caseId: row.id,
    stateCode: homeStateCode(region),
    filingWindowHours: filingWindowHours(region),
    custodyTakenAt: filing.custodyTakenAt,
    dueAt,
    physicianRequestedAt: filing.physicianRequestedAt,
    physicianDueAt: physicianDueAt(filing.physicianRequestedAt),
    physicianCertifiedAt: filing.physicianCertifiedAt,
    certifyingPhysician: filing.certifyingPhysician,
    filedAt: filing.filedAt,
    filedByName,
    stateFileNumber: filing.stateFileNumber,
    standing: filingStanding(filing, row.kind, dueAt, now),
  };
}
