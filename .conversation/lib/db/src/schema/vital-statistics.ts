import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What the death certificate needs, collected from the family.
 *
 * This is the most deadline-driven paperwork in the whole process and the
 * part that most often delays everything else. The certificate cannot be
 * filed without it; the burial permit waits on the certificate; the cemetery
 * waits on the permit. A missing mother's maiden name on a Wednesday is a
 * funeral that moves.
 *
 * And almost none of it is known to the funeral director. It is known to a
 * daughter, who has to ring an aunt to ask what her grandmother's maiden name
 * was, and find a discharge certificate in a drawer, and remember how many
 * years of school her father finished. That is a research task, not a
 * conversation — which is exactly why doing it across a desk at an
 * arrangement conference goes badly and doing it at home, over two evenings,
 * goes fine.
 *
 * Everything here is stored as free text, including things that look like
 * enumerations. Two reasons, and the second is the one that decided it:
 *
 *  1. The fields vary by state. There are more than fifty registration
 *     jurisdictions and they do not agree on education categories, on race
 *     and ethnicity options, or on what counts as an occupation.
 *  2. A dropdown that does not contain the true answer produces a confident
 *     wrong one. "Some college" when the truth is a nursing diploma from
 *     1961 is worse than free text, because nobody looks at it again.
 *
 * The funeral home's own software has the state's actual form. This exists to
 * gather the facts so somebody is not chasing them by telephone.
 *
 * **This is the most sensitive row in the database.** It carries a social
 * security number, so that column is encrypted at rest with the same key as
 * uploaded files — see `crypto.ts` — and is never returned to the family
 * portal once written.
 */
export const vitalStatisticsTable = pgTable(
  "vital_statistics",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /* --------------------------------------------------------- the person */

    legalFirstName: text("legal_first_name"),
    legalMiddleName: text("legal_middle_name"),
    legalLastName: text("legal_last_name"),
    /** A maiden or former name, which the certificate asks for separately. */
    nameAtBirth: text("name_at_birth"),
    suffix: text("suffix"),

    dateOfBirth: text("date_of_birth"),
    birthCity: text("birth_city"),
    birthState: text("birth_state"),
    /** Certificates ask for the country when it was not the United States. */
    birthCountry: text("birth_country"),

    sex: text("sex"),

    /**
     * AES-256-GCM ciphertext, never plaintext. Decrypted only for staff, and
     * only ever returned to the console masked to its last four digits --
     * which is all anybody needs to confirm they have the right number.
     */
    socialSecurityNumber: text("social_security_number"),

    /* ------------------------------------------------------- their family */

    maritalStatus: text("marital_status"),
    /** The surviving spouse, and their name before marriage if it changed. */
    spouseName: text("spouse_name"),
    spouseNameAtBirth: text("spouse_name_at_birth"),

    fatherFirstName: text("father_first_name"),
    fatherMiddleName: text("father_middle_name"),
    fatherLastName: text("father_last_name"),

    motherFirstName: text("mother_first_name"),
    motherMiddleName: text("mother_middle_name"),
    /**
     * The single field that most often stalls a certificate. Asked for by
     * name, with an explanation, because "mother's maiden name" is a phrase
     * people half-recognise from banking security questions.
     */
    motherMaidenName: text("mother_maiden_name"),

    /* ------------------------------------------------------ their life */

    /** Usual occupation, and the kind of business. Both are asked for. */
    occupation: text("occupation"),
    industry: text("industry"),
    educationLevel: text("education_level"),

    /** Free text, because jurisdictions differ and self-description varies. */
    raceEthnicity: text("race_ethnicity"),
    hispanicOrigin: text("hispanic_origin"),

    /* --------------------------------------------------------- residence */

    residenceLine1: text("residence_line1"),
    residenceCity: text("residence_city"),
    residenceCounty: text("residence_county"),
    residenceState: text("residence_state"),
    residencePostalCode: text("residence_postal_code"),
    /** Some jurisdictions ask whether the address is inside city limits. */
    residenceInsideCityLimits: boolean("residence_inside_city_limits"),

    /* ----------------------------------------------------------- veteran */

    /**
     * Worth its own question rather than hiding in occupation. A veteran is
     * entitled to a flag, a headstone and burial in a national cemetery, and
     * families routinely do not know that -- so a "yes" here is the trigger
     * for the director to raise it.
     */
    veteran: boolean("veteran"),
    veteranBranch: text("veteran_branch"),
    veteranServiceDates: text("veteran_service_dates"),
    veteranDischargeDocument: text("veteran_discharge_document"),

    /* --------------------------------------------------------- disposition */

    dispositionType: text("disposition_type"),
    dispositionPlace: text("disposition_place"),

    /* --------------------------------------------------------- informant */

    /**
     * Who supplied the facts. The certificate names them, and it matters
     * later: when the registrar queries something, this is who gets rung.
     */
    informantName: text("informant_name"),
    informantRelationship: text("informant_relationship"),
    informantPhone: text("informant_phone"),

    /* ---------------------------------------------------------- workflow */

    /**
     * `collecting` — the family is still finding things out.
     * `submitted`  — they have said they are done.
     * `verified`   — staff have checked it against documents.
     */
    status: text("status").notNull().default("collecting"),
    submittedAt: timestamp("submitted_at"),
    verifiedAt: timestamp("verified_at"),
    verifiedByUserId: integer("verified_by_user_id"),

    /** Staff notes: what still needs a document, what the registrar queried. */
    staffNotes: text("staff_notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("vital_statistics_case_unique").on(table.caseId)],
);

export const VITALS_STATUSES = ["collecting", "submitted", "verified"] as const;
export type VitalsStatus = (typeof VITALS_STATUSES)[number];

export type VitalStatistics = typeof vitalStatisticsTable.$inferSelect;

/**
 * The fields the family is asked for, in the order they are asked.
 *
 * Grouped so the form can be broken into short screens: a family doing this
 * over two evenings should be able to finish "their parents" and stop,
 * rather than face forty fields at once.
 */
export const VITALS_SECTIONS = [
  {
    key: "person",
    title: "Their details",
    fields: [
      "legalFirstName",
      "legalMiddleName",
      "legalLastName",
      "suffix",
      "nameAtBirth",
      "dateOfBirth",
      "birthCity",
      "birthState",
      "birthCountry",
      "sex",
    ],
  },
  {
    key: "parents",
    title: "Their parents",
    fields: [
      "fatherFirstName",
      "fatherMiddleName",
      "fatherLastName",
      "motherFirstName",
      "motherMiddleName",
      "motherMaidenName",
    ],
  },
  {
    key: "marriage",
    title: "Marriage",
    fields: ["maritalStatus", "spouseName", "spouseNameAtBirth"],
  },
  {
    key: "life",
    title: "Work and schooling",
    fields: ["occupation", "industry", "educationLevel", "raceEthnicity", "hispanicOrigin"],
  },
  {
    key: "residence",
    title: "Where they lived",
    fields: [
      "residenceLine1",
      "residenceCity",
      "residenceCounty",
      "residenceState",
      "residencePostalCode",
    ],
  },
  {
    key: "veteran",
    title: "Military service",
    fields: [
      "veteran",
      "veteranBranch",
      "veteranServiceDates",
      "veteranDischargeDocument",
    ],
  },
  {
    key: "informant",
    title: "About you",
    fields: ["informantName", "informantRelationship", "informantPhone"],
  },
] as const;

/**
 * What has to be there before a certificate can realistically be filed.
 *
 * Not enforced — a family that genuinely does not know their father's middle
 * name must still be able to submit — but shown, so the director can see at a
 * glance which case is going to stall on Wednesday.
 */
export const VITALS_REQUIRED_FOR_FILING = [
  "legalFirstName",
  "legalLastName",
  "dateOfBirth",
  "birthCity",
  "birthState",
  "socialSecurityNumber",
  "fatherLastName",
  "motherMaidenName",
  "residenceCity",
  "residenceState",
  "informantName",
] as const;

/** Last four only. Enough to confirm the right number, useless if leaked. */
export function maskSsn(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••-••-${digits.slice(-4)}` : "•••";
}

export const ssnSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length === 0 || digits.length === 9, {
    message: "A social security number has nine digits.",
  });
