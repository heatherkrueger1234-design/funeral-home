import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { familyContactsTable } from "./family-contacts";
import { usersTable } from "./users";

/**
 * Dates a family can choose from, the clocks Colorado runs on a death, and
 * the record of who said we may write to them.
 *
 * Three things in one file because they are the same problem seen from three
 * angles: this product's whole relationship with a family is a handful of
 * messages and a handful of dates, and every one of them is either legally
 * timed or legally consented. Keeping them apart made it possible to add a
 * fourth thing that sends without noticing there was a rule about it.
 */

/* ------------------------------------------------------ offered times -- */

export const SLOT_KINDS = [
  "arrangement",
  "viewing",
  "drop_off",
  "collection",
  "other",
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

/**
 * Times a director has open, and a family taking one.
 *
 * This replaces four telephone calls with two taps. A director opens windows
 * when they have them; the family takes what it needs; nobody rings the
 * office three times to settle on Thursday at four.
 *
 * What it deliberately is not: a calendar. The home already has one, and
 * synchronising with it is a different product with a different failure
 * mode. This holds the handful of windows a director chose to offer *this
 * week*.
 *
 * The rule that makes it safe to put in front of a bereaved family is that
 * the home defines the options and the family only picks. There is nowhere
 * here for somebody to type "Thursday afternoon?" into a box and hope
 * somebody reads it, because a typed date that nobody read is how a family
 * ends up standing outside a locked chapel.
 */
export const appointmentSlotsTable = pgTable(
  "appointment_slots",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * Offered to one case, or to anybody the home has a link out to.
     *
     * Null is the useful default: a director opening three slots on Thursday
     * morning does not want to decide in advance which family gets them.
     */
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "cascade",
    }),

    kind: text("kind").notNull().default("other"),
    /** "Private viewing, immediate family". What the family reads. */
    label: text("label").notNull(),

    startsAt: timestamp("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),

    /** Which room, or which chapel. Shown once it is booked. */
    location: text("location"),

    offeredByUserId: integer("offered_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /**
     * Taken, and by whom.
     *
     * Both columns, because "the Hale case booked it" is what the director's
     * list needs and "Anne booked it" is what the director says out loud. A
     * booked slot is never deleted by the family — they release it, which
     * puts it back on offer.
     */
    takenByCaseId: integer("taken_by_case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    takenByContactId: integer("taken_by_contact_id").references(
      () => familyContactsTable.id,
      { onDelete: "set null" },
    ),
    takenAt: timestamp("taken_at"),

    /**
     * Withdrawn by the home. Kept rather than deleted so a family that had
     * it can be told it is gone rather than watching it vanish between one
     * page load and the next.
     */
    withdrawnAt: timestamp("withdrawn_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("appointment_slots_home_idx").on(table.funeralHomeId, table.startsAt),
    index("appointment_slots_case_idx").on(table.caseId),
    index("appointment_slots_taken_idx").on(table.takenByCaseId),
  ],
);

export const insertAppointmentSlotSchema = createInsertSchema(
  appointmentSlotsTable,
)
  .omit({
    id: true,
    funeralHomeId: true,
    takenByCaseId: true,
    takenByContactId: true,
    takenAt: true,
    withdrawnAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    kind: z.enum(SLOT_KINDS),
    durationMinutes: z.number().int().min(5).max(480),
  });
export type InsertAppointmentSlot = z.infer<typeof insertAppointmentSlotSchema>;
export type AppointmentSlot = typeof appointmentSlotsTable.$inferSelect;

/** Offerable to this case: not taken, not withdrawn, not in the past. */
export function isOpenTo(
  slot: AppointmentSlot,
  caseId: number,
  now = new Date(),
): boolean {
  if (slot.takenByCaseId !== null) return false;
  if (slot.withdrawnAt !== null) return false;
  if (slot.startsAt <= now) return false;
  return slot.caseId === null || slot.caseId === caseId;
}

/* ----------------------------------------------------- may we write -- */

export const MESSAGING_CHANNELS = ["sms", "email"] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

/**
 * Where a "yes" came from. Recorded because "we have consent" is not a
 * defence; "she ticked this box on this page at 14:02 on the ninth" is.
 */
export const CONSENT_SOURCES = [
  /** The family ticked the box on their own page. */
  "family_portal",
  /** A director recorded that the family asked to be texted. */
  "director_recorded",
  /** Given on the public request form by a family who found the home. */
  "intake_request",
  /** They texted back START after having stopped — see below. */
  "reply",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/**
 * Who has said we may write to them, when they said it, and how.
 *
 * The Telephone Consumer Protection Act carries statutory damages *per
 * message*, which makes an accidental text to somebody who never agreed one
 * of the few things in this product that can cost a funeral home real money.
 * So consent is a row with a timestamp and a source rather than a boolean on
 * a contact, and nothing in this component sends without reading it first.
 *
 * Keyed on the address rather than on the contact, and that is deliberate.
 * Contacts are per-case: the same daughter arranging her father's funeral in
 * March and her mother's in November is two rows, and a STOP she sent in
 * April has to still be honoured in November. The phone number is the thing
 * the person actually holds.
 *
 * **`revokedAt` is final.** Nothing sets it back to null, there is no
 * re-prompt, and a fresh grant for a revoked address is refused rather than
 * quietly replacing it. Somebody who has said stop once must never be asked
 * again by software. The way back is a telephone call to the home, which is
 * how a funeral home does everything else.
 */
export const messagingConsentsTable = pgTable(
  "messaging_consents",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * Which case the consent was given during, and by whom, where we know.
     * Both nullable and both `set null` on delete: the consent outlives the
     * case it was given on, because the person outlives it.
     */
    caseId: integer("case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    contactId: integer("contact_id").references(() => familyContactsTable.id, {
      onDelete: "set null",
    }),

    channel: text("channel").notNull(),
    /** E.164 for a phone, lower-cased for an email. See `consentKey`. */
    address: text("address").notNull(),

    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    source: text("source").notNull(),
    /** "Ticked the box on Margaret's page". Shown to the director as-is. */
    sourceDetail: text("source_detail"),
    recordedByUserId: integer("recorded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    revokedAt: timestamp("revoked_at"),
    /** The word they actually sent — "STOP", "UNSUBSCRIBE". Verbatim. */
    revokedReason: text("revoked_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /*
     * One row per address per channel per home. The uniqueness is what makes
     * "may we text this number" a single lookup rather than a scan for the
     * most recent of several rows that might disagree with each other — and
     * two rows disagreeing about consent is the state where somebody gets
     * texted after saying stop.
     */
    uniqueIndex("messaging_consents_address_unique").on(
      table.funeralHomeId,
      table.channel,
      table.address,
    ),
    index("messaging_consents_lookup_idx").on(table.channel, table.address),
    index("messaging_consents_case_idx").on(table.caseId),
  ],
);

export type MessagingConsent = typeof messagingConsentsTable.$inferSelect;

/**
 * The stored form of an address.
 *
 * Phone numbers arrive here already in E.164 — normalising them needs a
 * default country code and belongs with the sender, not the schema — so this
 * only trims and case-folds. Getting it wrong in either direction is a real
 * failure: a number stored two ways is a number that can be texted after a
 * STOP against the other spelling.
 */
export function consentKey(channel: MessagingChannel, address: string): string {
  const trimmed = address.trim();
  return channel === "email" ? trimmed.toLowerCase() : trimmed;
}

/** Whether this row permits a send. A missing row is a no, not a maybe. */
export function mayContact(row: MessagingConsent | undefined | null): boolean {
  return row != null && row.revokedAt === null;
}

/**
 * The words a carrier and the TCPA both expect to stop everything.
 *
 * Matched on the whole message rather than on "contains", because "please
 * stop sending these to my mother, she has enough" must also stop them and
 * "I cannot stop thinking about the service" must not be read as a keyword
 * either way. The first is handled by a human reading the director's inbox;
 * what this list has to get right is the one-word reply a carrier treats as
 * an opt-out whether or not we do.
 */
export const STOP_KEYWORDS = [
  "stop",
  "stopall",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "revoke",
  "optout",
  "opt-out",
] as const;

export function isStopKeyword(body: string): boolean {
  const word = body
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  return (STOP_KEYWORDS as readonly string[]).includes(word);
}

/* ------------------------------------------------ the statutory clocks -- */

/**
 * What a Colorado deadline is measured from.
 *
 * `disposition` carries no hours: the statute says "before", not "within",
 * and inventing a number would be us making up law. It renders as words.
 */
export const STATUTORY_ANCHORS = [
  "custody",
  "edrs_request",
  "death",
  "disposition",
] as const;
export type StatutoryAnchor = (typeof STATUTORY_ANCHORS)[number];

export type StatutoryDeadlineTemplate = {
  key: string;
  title: string;
  description: string;
  anchor: StatutoryAnchor;
  /** Hours after the anchor. Null where the statute says only "before". */
  offsetHours: number | null;
  /** Cremation-only items are not created for a burial. */
  appliesTo: "all" | "cremation";
  citation: string;
};

/**
 * Colorado's real clock, shipped in the standard schedule.
 *
 * These are not the home's preferences and a director does not construct
 * them: they are what the statute says, they apply to every at-need case in
 * the state, and the only useful thing a director can do with them is
 * confirm the two dates they hang off. So they apply themselves, and the
 * director corrects rather than types.
 *
 * They live in their own table rather than on `case_deadlines`, and the
 * reason is the family. `case_deadlines` is the timeline the family reads on
 * their own page, and "File the certificate of death — 72 hours" is the
 * home's legal obligation, not a widow's homework. Putting it there would
 * both alarm her and inflate the count of things she still has to do with
 * paperwork that was never hers.
 *
 * Wording note: every sentence below is written to be read calmly by a
 * director who is behind. No exclamation, no "URGENT", nothing that assumes
 * failure. Section 6 of `COLORADO.md` has the sources.
 */
export const COLORADO_STATUTORY_DEADLINES: ReadonlyArray<StatutoryDeadlineTemplate> =
  [
    {
      key: "death-certificate-filed",
      title: "File the certificate of death",
      description:
        "Colorado allows 72 hours from taking custody, and it has to be filed before disposition. Filed through the state's EDRS — we do not file it for you.",
      anchor: "custody",
      offsetHours: 72,
      appliesTo: "all",
      citation: "C.R.S. 25-2-110, as amended by SB 23-020",
    },
    {
      key: "medical-certification",
      title: "Medical certification returned",
      description:
        "The certifying physician has 72 hours from receiving the EDRS request. Worth a call at about 48 if nothing has come back.",
      anchor: "edrs_request",
      offsetHours: 72,
      appliesTo: "all",
      citation: "C.R.S. 25-2-110, as amended by SB 23-020",
    },
    {
      key: "embalming-or-refrigeration",
      title: "Embalming or refrigeration",
      description:
        "Required once 24 hours have passed since the death, whichever the family has chosen.",
      anchor: "death",
      offsetHours: 24,
      appliesTo: "all",
      citation: "Colorado disposition rules, 24 hours from death",
    },
    {
      key: "disposition-permit",
      title: "Authorization for Final Disposition in hand",
      description:
        "From the county vital records office or the coroner. Needed before disposition.",
      anchor: "disposition",
      offsetHours: null,
      appliesTo: "all",
      citation: "Colorado disposition permit requirement",
    },
    {
      key: "cremation-authorization",
      title: "Cremation authorization signed",
      description:
        "Signed by the person holding the right of final disposition, and naming which statutory tier that was under. The crematory may not proceed without it.",
      anchor: "disposition",
      offsetHours: null,
      appliesTo: "cremation",
      citation: "C.R.S. Title 15, Article 19",
    },
  ];

/**
 * The two dates only a director knows, and the software must not guess.
 *
 * Taking custody starts the 72-hour clock on the death certificate, and the
 * EDRS request starts the physician's. Neither is derivable from anything
 * else on the case: a home can take custody days after the death, and the
 * request goes out when a human sends it.
 *
 * So the case opens with custody *proposed* — set to when the case was
 * created, which is right far more often than it is wrong — and marked as
 * assumed until somebody says otherwise. A proposed date that is visibly
 * proposed is better than an empty field nobody fills in, and much better
 * than a confident wrong one.
 */
export const caseStatutoryClocksTable = pgTable(
  "case_statutory_clocks",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    custodyTakenAt: timestamp("custody_taken_at"),
    /** True while `custodyTakenAt` is our proposal rather than a director's. */
    custodyAssumed: boolean("custody_assumed").notNull().default(true),

    edrsRequestedAt: timestamp("edrs_requested_at"),

    confirmedByUserId: integer("confirmed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    confirmedAt: timestamp("confirmed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_statutory_clocks_case_unique").on(table.caseId),
    index("case_statutory_clocks_home_idx").on(table.funeralHomeId),
  ],
);

export type CaseStatutoryClock = typeof caseStatutoryClocksTable.$inferSelect;

/**
 * A statutory deadline as it stands on one case.
 *
 * Title and description are snapshotted from the template rather than joined,
 * because a director may reword one for this case and because amending the
 * constant should not retroactively rewrite what a home was told in March.
 */
export const caseStatutoryDeadlinesTable = pgTable(
  "case_statutory_deadlines",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** Which entry of `COLORADO_STATUTORY_DEADLINES` this is. */
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    citation: text("citation"),

    anchor: text("anchor").notNull(),
    /** Null where the statute says "before disposition" and nothing more. */
    dueAt: timestamp("due_at"),

    completedAt: timestamp("completed_at"),
    completedByUserId: integer("completed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /**
     * Set when this one genuinely does not apply — a burial case that had a
     * cremation authorization created before the disposition type was known.
     * Dismissing rather than deleting keeps the record that somebody looked.
     */
    notApplicableAt: timestamp("not_applicable_at"),
    notApplicableReason: text("not_applicable_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_statutory_deadlines_case_key_unique").on(
      table.caseId,
      table.key,
    ),
    index("case_statutory_deadlines_home_idx").on(
      table.funeralHomeId,
      table.dueAt,
    ),
  ],
);

export type CaseStatutoryDeadline =
  typeof caseStatutoryDeadlinesTable.$inferSelect;

/**
 * Where a statutory deadline stands, for the director's console.
 *
 * Note what is not here: nothing that renders as a countdown, and no level
 * that means "alarming". `passed` is a statement of fact a director needs;
 * the console says it in words and never in red. See the craft standard in
 * `TEAM-SPLIT.md` — this is the console, and the family never sees any of it.
 */
export const STATUTORY_STANDINGS = [
  "done",
  "not_applicable",
  "before_disposition",
  "no_date_yet",
  "ahead",
  "soon",
  "passed",
] as const;
export type StatutoryStanding = (typeof STATUTORY_STANDINGS)[number];

/** Inside this, a director wants to be looking at it. */
const SOON_HOURS = 24;

export function standingOf(
  row: Pick<
    CaseStatutoryDeadline,
    "completedAt" | "notApplicableAt" | "anchor" | "dueAt"
  >,
  now = new Date(),
): StatutoryStanding {
  if (row.completedAt !== null) return "done";
  if (row.notApplicableAt !== null) return "not_applicable";
  if (row.anchor === "disposition") return "before_disposition";
  if (row.dueAt === null) return "no_date_yet";

  const hoursLeft = (row.dueAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft < 0) return "passed";
  return hoursLeft <= SOON_HOURS ? "soon" : "ahead";
}

/**
 * What the standing is called, in words.
 *
 * Written here rather than in the console so that every screen says the same
 * sentence, and so that "the 72 hours have passed" is never rendered as a
 * number going red. A director who is late already knows; what they need is
 * to be told plainly and told once.
 */
export function describeStanding(standing: StatutoryStanding): string {
  switch (standing) {
    case "done":
      return "Done";
    case "not_applicable":
      return "Does not apply to this case";
    case "before_disposition":
      return "Needed before disposition";
    case "no_date_yet":
      return "Waiting on a date to measure from";
    case "ahead":
      return "In hand";
    case "soon":
      return "Due within the day";
    case "passed":
      return "The time allowed has passed";
  }
}
