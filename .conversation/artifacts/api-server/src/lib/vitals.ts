import { and, eq } from "drizzle-orm";
import {
  db,
  vitalStatisticsTable,
  usersTable,
  maskSsn,
  VITALS_REQUIRED_FOR_FILING,
  type VitalStatistics,
} from "@workspace/db";
import { encrypt, decrypt } from "@workspace/db/crypto";
import { logger } from "./logger";

/**
 * The death certificate record, and the one field in it that needs care.
 *
 * A social security number is the most sensitive thing this product stores.
 * It is encrypted at rest with the same key as uploaded files, and it is
 * never returned by the API to either side — the console gets the last four
 * digits, which is all anybody needs to confirm they have the right number,
 * and the family portal gets only whether one has been supplied.
 *
 * That means a family cannot read back what they typed. This is the right
 * trade: the cost is re-typing nine digits if they got them wrong, and the
 * benefit is that a forwarded link to a phone left on a kitchen table does
 * not display a dead person's SSN.
 */

/** Columns the API may write. Everything else is workflow, set by handlers. */
const WRITABLE = [
  "legalFirstName", "legalMiddleName", "legalLastName", "nameAtBirth", "suffix",
  "dateOfBirth", "birthCity", "birthState", "birthCountry", "sex",
  "maritalStatus", "spouseName", "spouseNameAtBirth",
  "fatherFirstName", "fatherMiddleName", "fatherLastName",
  "motherFirstName", "motherMiddleName", "motherMaidenName",
  "occupation", "industry", "educationLevel", "raceEthnicity", "hispanicOrigin",
  "residenceLine1", "residenceCity", "residenceCounty", "residenceState",
  "residencePostalCode", "residenceInsideCityLimits",
  "veteran", "veteranBranch", "veteranServiceDates", "veteranDischargeDocument",
  "dispositionType", "dispositionPlace",
  "informantName", "informantRelationship", "informantPhone",
] as const;

export type WritableField = (typeof WRITABLE)[number];

/**
 * Pick only the columns a caller is allowed to set.
 *
 * An allow-list rather than a deny-list: a field added to the table later is
 * not writable until somebody puts it here on purpose, which is the safer
 * direction for a row holding this much personal data.
 */
export function pickWritable(body: Record<string, unknown>) {
  const values: Record<string, unknown> = {};

  for (const field of WRITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const value = body[field];
      values[field] =
        typeof value === "string" ? value.trim() || null : (value ?? null);
    }
  }

  return values;
}

/** Created on first read, so no caller has to handle a missing record. */
export async function vitalsForCase(
  caseId: number,
  funeralHomeId: number,
): Promise<VitalStatistics> {
  const [existing] = await db
    .select()
    .from(vitalStatisticsTable)
    .where(
      and(
        eq(vitalStatisticsTable.caseId, caseId),
        eq(vitalStatisticsTable.funeralHomeId, funeralHomeId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(vitalStatisticsTable)
    .values({ funeralHomeId, caseId })
    .onConflictDoNothing({ target: vitalStatisticsTable.caseId })
    .returning();

  if (created) return created;

  // Lost a race with another tab opening the same form.
  const [raced] = await db
    .select()
    .from(vitalStatisticsTable)
    .where(eq(vitalStatisticsTable.caseId, caseId))
    .limit(1);

  return raced!;
}

/** Encrypt an SSN for storage, or clear it. */
export function encryptSsn(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return null;

  return encrypt(digits);
}

function readSsn(stored: string | null): string | null {
  if (!stored) return null;

  try {
    return decrypt(stored);
  } catch (err) {
    // A key rotation or a corrupt row must not take down the whole form.
    logger.error({ err }, "Could not decrypt a stored SSN");
    return null;
  }
}

/**
 * What is still missing before a certificate can realistically be filed.
 *
 * Shown, never enforced. A family that genuinely does not know their father's
 * middle name must still be able to submit — but the director needs to see,
 * on Monday, which case is going to stall on Wednesday.
 */
export function missingForFiling(row: VitalStatistics): string[] {
  return VITALS_REQUIRED_FOR_FILING.filter((field) => {
    const value = row[field as keyof VitalStatistics];
    return value === null || value === undefined || value === "";
  });
}

export async function toVitalsJson(row: VitalStatistics) {
  const ssn = readSsn(row.socialSecurityNumber);

  let verifiedByName: string | null = null;

  if (row.verifiedByUserId !== null) {
    const [user] = await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, row.verifiedByUserId))
      .limit(1);
    verifiedByName = user?.displayName ?? null;
  }

  const {
    id,
    funeralHomeId,
    socialSecurityNumber,
    verifiedByUserId,
    createdAt,
    updatedAt,
    ...rest
  } = row;
  void id;
  void funeralHomeId;
  void socialSecurityNumber;
  void verifiedByUserId;
  void createdAt;
  void updatedAt;

  return {
    ...rest,
    // Never the number itself, to either side.
    socialSecurityNumberMasked: maskSsn(ssn),
    hasSocialSecurityNumber: ssn !== null,
    verifiedByName,
    missingForFiling: missingForFiling(row),
  };
}
