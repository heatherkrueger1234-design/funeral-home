import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * Colorado's death certificate clock, as the director's own record of it.
 *
 * SB 23-020 replaced the old five-day window: a certificate of death must now
 * be filed with the State Registrar **within 72 hours of assuming custody**
 * of the body, and before final disposition. Separately, the certifying
 * physician has 72 hours from the moment they are asked through EDRS. The
 * family-facing half of this already exists -- `vital_statistics` gathers
 * what only the family knows -- but nothing recorded the moment the clock
 * started, so nothing could say when it would run out.
 *
 * **We do not integrate with EDRS and we file nothing.** There is no state
 * API here, no submission and no acknowledgement. What this row holds is
 * when the home took custody, when the physician was asked, and when the
 * home filed -- each typed by a person at the home, after the fact. Every
 * screen that shows it says so, because a director who believes this product
 * filed a certificate for them is a director who finds out otherwise from
 * the registrar.
 *
 * Its own table rather than more columns on `vital_statistics`, and the
 * reason is who reads it. That row is answered by the family and read back
 * to them; this one is staff-only from the first column to the last, and
 * keeping it apart means no family response can ever be one careless
 * spread away from a deadline, a physician's name or a director's note.
 *
 * It is never shown to the family as a clock. CRAFT.md is explicit that a
 * widow does not need a timer; the director does, and it belongs in the
 * console.
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

    /**
     * When the home took custody of the body. The start of the 72 hours.
     *
     * Not the date of death, and the distinction is the whole point: a person
     * found on a Sunday and released by the coroner on a Tuesday starts this
     * clock on Tuesday. Null until a director records it, because nothing in
     * this product may invent the fact a legal deadline is measured from.
     */
    custodyTakenAt: timestamp("custody_taken_at"),

    /** When the certifying physician was asked through EDRS. Their 72 hours. */
    physicianRequestedAt: timestamp("physician_requested_at"),
    /** Who was asked, so the follow-up call has a name on it. */
    certifyingPhysician: text("certifying_physician"),
    /**
     * When the physician completed the medical certification, as the
     * director saw it in EDRS. The home cannot file until this has happened,
     * so it is the fact that says whose move it is.
     */
    physicianCertifiedAt: timestamp("physician_certified_at"),

    /**
     * When the *home* filed it, in the state's own system. Typed by the
     * director afterwards -- nobody tells us this, a person records it.
     */
    filedAt: timestamp("filed_at"),
    /** Who recorded the filing. Stored, not joined, like `verifiedByUserId`. */
    filedByUserId: integer("filed_by_user_id"),
    /**
     * The state file number, once there is one. Free text; formats differ.
     *
     * There is deliberately no notes column. "What the registrar queried"
     * already has a home in `vital_statistics.staffNotes`, on the same tab,
     * and two boxes for one kind of note is how half of them get missed.
     */
    stateFileNumber: text("state_file_number"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("death_certificate_filings_case_unique").on(table.caseId),
    index("death_certificate_filings_home_idx").on(
      table.funeralHomeId,
      table.filedAt,
    ),
  ],
);

export type DeathCertificateFiling =
  typeof deathCertificateFilingsTable.$inferSelect;

/**
 * Hours from custody to filing, by state, where we have checked the statute.
 *
 * One entry, on purpose. Colorado's is verified (COLORADO.md, section 5, with
 * sources); every other state's window differs and none has been checked, so
 * a home elsewhere sees its custody and filing dates recorded but no due
 * time. A deadline we guessed at would be worse than none: a director
 * trusts a date printed on their screen.
 */
const FILING_HOURS_BY_STATE: Record<string, number> = { CO: 72 };

/** The physician's separate clock, from the EDRS request (SB 23-020). */
export const PHYSICIAN_CERTIFICATION_HOURS = 72;

const HOUR = 60 * 60 * 1000;

/**
 * A home's state as the two-letter code, from whatever was typed.
 *
 * `region` is free text on the home's settings page, so "CO", "co",
 * "Colorado" and " Colorado " all mean the same thing. A blank region is
 * read as Colorado: it is the only market this product is sold in, and the
 * same assumption already sets every new home's clock to `America/Denver`.
 * A home that has said it is somewhere else is believed.
 */
export function homeStateCode(region: string | null | undefined): string {
  const typed = (region ?? "").trim().toUpperCase();
  if (typed === "" || typed === "COLORADO") return "CO";
  return typed;
}

/** Hours to file in this home's state, or null where we do not know them. */
export function filingWindowHours(
  region: string | null | undefined,
): number | null {
  return FILING_HOURS_BY_STATE[homeStateCode(region)] ?? null;
}

/** When the certificate is due, or null while custody is unrecorded. */
export function certificateDueAt(
  custodyTakenAt: Date | null,
  region: string | null | undefined,
): Date | null {
  const hours = filingWindowHours(region);
  if (custodyTakenAt === null || hours === null) return null;
  return new Date(custodyTakenAt.getTime() + hours * HOUR);
}

/** When the physician's certification is due, on their own clock. */
export function physicianDueAt(physicianRequestedAt: Date | null): Date | null {
  return physicianRequestedAt === null
    ? null
    : new Date(
        physicianRequestedAt.getTime() + PHYSICIAN_CERTIFICATION_HOURS * HOUR,
      );
}
