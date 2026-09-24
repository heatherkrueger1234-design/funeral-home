import {
  pgTable,
  text,
  serial,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What Colorado requires of each home we sell to, and how close it is.
 *
 * This is the only table in the database that exists for *us* rather than for
 * a family. Colorado spent decades as the one state that licensed nobody, and
 * then rewrote the whole regime after Return to Nature and Sunset Mesa. Every
 * Colorado home reading this in 2026 has an unfinished pile of DORA paperwork
 * and a deadline in January. Keeping their registration details next to their
 * account costs us almost nothing and is the most useful thing the console
 * can show this year — see Section 2 of `COLORADO.md`.
 *
 * It is maintained by the platform, not by the home. That is a deliberate
 * line: a platform admin may not touch a family's photographs or a case's
 * obituary, but this is our own note of who our customer is, the same as
 * their billing address. Nothing here is fed back into the home's product,
 * and nothing here is authoritative — DORA's public register is.
 *
 * Note the spelling: `licence` in the columns and the comments, because the
 * codebase writes British English internally; every string a director or
 * Heather actually reads says "license", because these are American homes.
 * It is not a typo, and it does not need fixing.
 */
export const homeLicensureTable = pgTable(
  "home_licensure",
  {
    id: serial("id").primaryKey(),
    /**
     * One row per home, enforced below. A home has one registration per
     * location and we track the establishment, not the branch — a home with
     * two chapels gets a second account, which is also how they are billed.
     */
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** As issued by DORA under C.R.S. 12-135-110. Free text: the format has
     * changed twice since 2024 and validating it would only reject reality. */
    doraRegistrationNumber: text("dora_registration_number"),

    /**
     * The services the home registered as providing at this location.
     * Free-text entries rather than a fixed list: the registration form's
     * vocabulary is DORA's and it moves, and a home typing what is on their
     * own certificate is more use than a dropdown that nearly matches it.
     */
    registeredServices: text("registered_services").array().notNull().default([]),

    /** The appointed designee named on the registration. A person, not a role. */
    designeeName: text("designee_name"),
    designeeTitle: text("designee_title"),

    /**
     * Calendar dates, stored as dates and handled as strings.
     *
     * A renewal falls on a day, not at an instant, and the moment one of
     * these becomes a `Date` it acquires a midnight in some timezone and
     * starts arriving a day early for anyone west of it. Nothing here is ever
     * subtracted from a clock, so a string is not a shortcut — it is the
     * honest type.
     */
    beganBusinessOn: date("began_business_on", { mode: "string" }),
    registrationRenewsOn: date("registration_renews_on", { mode: "string" }),

    /**
     * The 30-day clock from C.R.S. 12-135-110: adding a service means an
     * amended registration within thirty days of the change.
     *
     * Two dates rather than a boolean, because the useful question is not
     * "is there an amendment outstanding" but "how long has it been" — and a
     * home that changes its services again next spring needs the clock to
     * start over without anyone remembering to clear a flag.
     */
    servicesChangedOn: date("services_changed_on", { mode: "string" }),
    amendmentFiledOn: date("amendment_filed_on", { mode: "string" }),

    /** Anything the registration does not have a field for. */
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("home_licensure_home_unique").on(table.funeralHomeId),
  ],
);

/**
 * The people at a home who need a licence by 1 January 2027.
 *
 * Deliberately not joined to `users`. The person who has to hold a mortuary
 * science licence is often not the person who signs in — the embalmer who
 * works three homes has no account anywhere, and the office manager who lives
 * in the console needs no licence at all. Tying these rows to staff accounts
 * would quietly exclude exactly the people the deadline is about.
 */
export const practitionerLicencesTable = pgTable(
  "practitioner_licences",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    personName: text("person_name").notNull(),
    /** One of `PRACTITIONER_ROLES`, unvalidated at the database. */
    role: text("role").notNull().default("mortuary_science_practitioner"),

    /** One of `LICENCE_STANDINGS`. */
    standing: text("standing").notNull().default("not_applied"),
    licenceNumber: text("licence_number"),
    /** Null while the standing is anything other than held. */
    expiresOn: date("expires_on", { mode: "string" }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("practitioner_licences_home_idx").on(
      table.funeralHomeId,
      table.personName,
    ),
  ],
);

/** The five roles SB 24-173 brought under licensure. */
export const PRACTITIONER_ROLES = [
  "mortuary_science_practitioner",
  "funeral_director",
  "embalmer",
  "cremationist",
  "natural_reductionist",
] as const;
export type PractitionerRole = (typeof PRACTITIONER_ROLES)[number];

/** As a person reads it. US spelling: Heather and her customers are American. */
export const PRACTITIONER_ROLE_LABELS: Record<PractitionerRole, string> = {
  mortuary_science_practitioner: "Mortuary science practitioner",
  funeral_director: "Funeral director",
  embalmer: "Embalmer",
  cremationist: "Cremationist",
  natural_reductionist: "Natural reductionist",
};

/**
 * Where somebody has got to. `provisional` is its own standing rather than a
 * flag on `held` because a provisional licence runs three years from issue
 * and a full one issued now runs to 30 November 2027 — the expiry means a
 * different thing in each case, and a director deciding what to do next week
 * needs to see which one they are looking at.
 */
export const LICENCE_STANDINGS = [
  "not_applied",
  "applied",
  "provisional",
  "held",
] as const;
export type LicenceStanding = (typeof LICENCE_STANDINGS)[number];

export const LICENCE_STANDING_LABELS: Record<LicenceStanding, string> = {
  not_applied: "Not applied for yet",
  applied: "Application in",
  provisional: "Provisional license",
  held: "Licensed",
};

/** SB 24-173. Not a date we chose and not one we can move. */
export const PRACTITIONER_LICENSURE_DEADLINE = "2027-01-01";

/** C.R.S. 12-135-110: an amended registration is due within thirty days. */
export const AMENDED_REGISTRATION_DAYS = 30;

/**
 * How far ahead something has to be before it stops being worth mentioning.
 * Three months is roughly one renewal cycle's worth of notice, and it is also
 * long enough that nobody has to act today — which is the whole point.
 */
const HORIZON_DAYS = 90;

export type HomeLicensure = typeof homeLicensureTable.$inferSelect;
export type PractitionerLicence = typeof practitionerLicencesTable.$inferSelect;

export const insertHomeLicensureSchema = createInsertSchema(
  homeLicensureTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertHomeLicensure = z.infer<typeof insertHomeLicensureSchema>;

export const insertPractitionerLicenceSchema = createInsertSchema(
  practitionerLicencesTable,
).omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true });
export type InsertPractitionerLicence = z.infer<
  typeof insertPractitionerLicenceSchema
>;

/**
 * What a reminder is, and what it is deliberately not.
 *
 * `standing` is the worst it gets. There is no "critical", no count of days
 * rendered in red, and no badge — a funeral director looking at this screen
 * is already three months from a deadline they did not ask for, and a product
 * that shouts at them about it is a product they close. The severity exists
 * only to sort the list; the copy carries the meaning.
 */
export type ReminderStanding = "settled" | "ahead" | "soon" | "passed";

export type LicensureReminder = {
  /** Stable across renders, so React can key on it. */
  key: string;
  /** One sentence, plainly. Read on its own without the detail. */
  summary: string;
  /** What to do, and what happens if it slips. */
  detail: string;
  standing: ReminderStanding;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` to a calendar date, negative once it is past. */
export function daysUntil(isoDate: string, now = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return Math.round((target - today) / DAY_MS);
}

/**
 * "in about 3 months", "in 11 days", "on 4 March". Never "3 days left".
 *
 * The difference is not cosmetic. A countdown is a pressure device, and the
 * thing being counted down to here is somebody's licence to do the job they
 * have done for thirty years. So: an approximation while it is far away, a
 * plain number of days once acting on it is realistic, and past tense once it
 * has gone, with no arithmetic at all in the last case.
 */
export function describeWhen(isoDate: string, now = new Date()): string {
  const days = daysUntil(isoDate, now);

  if (days < 0) return "already passed";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 45) return `in ${days} days`;

  const months = Math.round(days / 30);
  return `in about ${months} month${months === 1 ? "" : "s"}`;
}

function standingFor(days: number): ReminderStanding {
  if (days < 0) return "passed";
  if (days <= HORIZON_DAYS) return "soon";
  return "ahead";
}

/**
 * The January deadline does not get the ninety-day horizon, and that is the
 * point rather than an oversight.
 *
 * Everything else here recurs: a registration renews, a licence is reissued,
 * and three months is plenty of notice for something that will come round
 * again. Licensure under SB 24-173 happens once, to people who have done this
 * job for thirty years without ever needing a licence, and an application
 * takes longer than the ninety days a renewal needs. Somebody who has not
 * applied is worth mentioning whether the date is four months out or four
 * weeks — so while anyone is outstanding, this reads as "coming up".
 *
 * It still never reads as an alarm, and it still never counts down.
 */
function deadlineStanding(days: number): ReminderStanding {
  return days < 0 ? "passed" : "soon";
}

/**
 * Everything worth saying to a platform admin about one home's licensure,
 * ordered most-pressing first.
 *
 * Returns an empty list when a home is genuinely in order, and the console
 * says so in words rather than rendering nothing.
 */
export function licensureReminders(
  licensure: HomeLicensure | null,
  practitioners: readonly PractitionerLicence[],
  now = new Date(),
): LicensureReminder[] {
  const reminders: LicensureReminder[] = [];

  /* ------------------------------------------- the deadline in January */

  const unlicensed = practitioners.filter(
    (person) => person.standing === "not_applied" || person.standing === "applied",
  );
  const deadlineDays = daysUntil(PRACTITIONER_LICENSURE_DEADLINE, now);

  if (deadlineDays >= 0 && practitioners.length === 0) {
    reminders.push({
      key: "deadline-nobody-listed",
      summary: `Nobody is listed here yet, and Colorado licensure is due ${describeWhen(
        PRACTITIONER_LICENSURE_DEADLINE,
        now,
      )}.`,
      detail:
        "Senate Bill 24-173 requires every practitioner, director, embalmer, " +
        "cremationist and natural reductionist to hold a license by " +
        "1 January 2027. Adding the people this applies to is how the rest of " +
        "this page becomes useful.",
      standing: deadlineStanding(deadlineDays),
    });
  } else if (deadlineDays >= 0 && unlicensed.length > 0) {
    reminders.push({
      key: "deadline-outstanding",
      summary:
        (practitioners.length === 1
          ? "The one person here does not have a license yet. "
          : unlicensed.length === practitioners.length
            ? `None of the ${practitioners.length} people here has a license yet. `
            : `${unlicensed.length} of ${practitioners.length} people here ` +
              `${unlicensed.length === 1 ? "does" : "do"} not have a license yet. `) +
        `The deadline is ${describeWhen(
          PRACTITIONER_LICENSURE_DEADLINE,
          now,
        )}.`,
      detail:
        unlicensed.map((person) => person.personName).join(", ") +
        ". Provisional licenses run three years from issue, so an application " +
        "in now still lands in time.",
      standing: deadlineStanding(deadlineDays),
    });
  } else if (deadlineDays < 0 && unlicensed.length > 0) {
    reminders.push({
      key: "deadline-passed",
      summary:
        unlicensed.length === 1
          ? "1 person here is working without a license on record."
          : `${unlicensed.length} people here are working without a license on record.`,
      detail:
        "The 1 January 2027 deadline has passed. This is the home's own " +
        "record to correct with DORA; what we can do is make sure it is not " +
        "a surprise.",
      standing: "passed",
    });
  }

  /* ------------------------------------ the thirty days after a change */

  if (
    licensure?.servicesChangedOn &&
    (licensure.amendmentFiledOn === null ||
      licensure.amendmentFiledOn < licensure.servicesChangedOn)
  ) {
    const dueOn = new Date(
      Date.parse(`${licensure.servicesChangedOn}T00:00:00Z`) +
        AMENDED_REGISTRATION_DAYS * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const days = daysUntil(dueOn, now);

    reminders.push({
      key: "amended-registration",
      summary:
        days < 0
          ? "An amended registration was due thirty days after the services changed."
          : `An amended registration is due ${describeWhen(dueOn, now)}.`,
      detail:
        "The services at this location changed on " +
        `${licensure.servicesChangedOn}. C.R.S. 12-135-110 gives an ` +
        "establishment thirty days to file the amendment with DORA. Record " +
        "the date it was filed and this goes away.",
      standing: standingFor(days),
    });
  }

  /* -------------------------------------------- the registration itself */

  if (licensure?.registrationRenewsOn) {
    const days = daysUntil(licensure.registrationRenewsOn, now);

    if (days <= HORIZON_DAYS) {
      reminders.push({
        key: "registration-renewal",
        summary:
          days < 0
            ? "The DORA registration renewal date has passed."
            : `The DORA registration renews ${describeWhen(
                licensure.registrationRenewsOn,
                now,
              )}.`,
        detail:
          "At renewal an establishment attests whether it sells preneed " +
          "contracts, and DORA shares that with the Insurance Commissioner. " +
          "Worth a call before it lands.",
        standing: standingFor(days),
      });
    }
  }

  /* ------------------------------------------------ individual expiries */

  for (const person of practitioners) {
    if (!person.expiresOn) continue;

    const days = daysUntil(person.expiresOn, now);
    if (days > HORIZON_DAYS) continue;

    reminders.push({
      key: `expiry-${person.id}`,
      summary:
        days < 0
          ? `${person.personName}'s license expired on ${person.expiresOn}.`
          : `${person.personName}'s license expires ${describeWhen(
              person.expiresOn,
              now,
            )}.`,
      detail:
        PRACTITIONER_ROLE_LABELS[person.role as PractitionerRole] ??
        "Practitioner",
      standing: standingFor(days),
    });
  }

  const order: Record<ReminderStanding, number> = {
    passed: 0,
    soon: 1,
    ahead: 2,
    settled: 3,
  };

  return reminders.sort((a, b) => order[a.standing] - order[b.standing]);
}
