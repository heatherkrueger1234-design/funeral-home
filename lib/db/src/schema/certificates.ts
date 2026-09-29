import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * Colorado's 72-hour death-certificate clock (SB 23-020), ported from the
 * forms branch.
 *
 * The home must file the certificate with the State Registrar through EDRS
 * within 72 hours of taking custody, and the certifying physician has 72
 * hours from the EDRS request. We file nothing: this is the director's own
 * record of when the clocks started and that they filed.
 *
 * Anchored on custody, not death: a person released by the coroner on a
 * Tuesday starts the clock on Tuesday. Custody is nullable because nothing
 * here may invent the fact a legal deadline is measured from.
 */
export const deathCertificateFilingsTable = pgTable(
  "death_certificate_filings",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** When the home took custody. The start of the 72 hours. */
    custodyTakenAt: timestamp("custody_taken_at"),
    /** When the certifying physician was asked through EDRS. Their 72 hours. */
    edrsRequestedAt: timestamp("edrs_requested_at"),
    /** Who was asked, so the follow-up call has a name on it. */
    certifyingProvider: text("certifying_provider"),
    /** When the physician certified, as the director saw it in EDRS. */
    certifiedAt: timestamp("certified_at"),
    /** When the home filed it, ticked by the director after doing so. */
    filedAt: timestamp("filed_at"),
    filedByUserId: integer("filed_by_user_id"),
    /** The state file number, once there is one. Formats differ. */
    stateFileNumber: text("state_file_number"),
    /** What the registrar queried, what is outstanding. Staff only. */
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("death_certificate_filings_case_unique").on(table.caseId),
    index("death_certificate_filings_home_idx").on(table.funeralHomeId),
  ],
);

export type DeathCertificateFiling = typeof deathCertificateFilingsTable.$inferSelect;

/** SB 23-020: the home's filing, and the physician's certification. */
export const CERTIFICATE_FILING_HOURS = 72;
export const CERTIFYING_PHYSICIAN_HOURS = 72;

const HOUR = 60 * 60 * 1000;

/** When the certificate is due, or null while custody is not recorded. */
export function certificateDueAt(row: Pick<DeathCertificateFiling, "custodyTakenAt">): Date | null {
  return row.custodyTakenAt
    ? new Date(row.custodyTakenAt.getTime() + CERTIFICATE_FILING_HOURS * HOUR)
    : null;
}

/** When the physician's certification is due, on its own clock. */
export function certificationDueAt(row: Pick<DeathCertificateFiling, "edrsRequestedAt">): Date | null {
  return row.edrsRequestedAt
    ? new Date(row.edrsRequestedAt.getTime() + CERTIFYING_PHYSICIAN_HOURS * HOUR)
    : null;
}

/** The sentence every screen showing the clock carries. */
export const CERTIFICATE_FILING_NOTICE =
  "We do not file this. Your home files the certificate through Colorado's EDRS " +
  "within 72 hours of taking custody; this keeps the clock and your record of it.";
