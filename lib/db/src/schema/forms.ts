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
import { familyContactsTable, FAMILY_ACCESS_LEVELS } from "./family-contacts";
import { funeralHomesTable } from "./funeral-homes";
import { usersTable } from "./users";
import { uploadsTable } from "./uploads";

/**
 * The home's own paperwork, and a family filling it in on a phone.
 *
 * Every funeral home has a folder of forms — a vital statistics worksheet, a
 * cremation authorisation, a release of effects, whatever their state and
 * their insurer require — and every one of those folders is different. So
 * this is not a fixed set of screens: a home uploads its own forms, names its
 * own boxes, and every family at that home gets the ones the home attached.
 *
 * **We never ship a legal form we invented.** Not a cremation authorisation,
 * not a disposition authorisation, not a vital statistics worksheet of our
 * own. A national vendor shipping its own authorisation form hands every home
 * it sells to a liability, and hands every family a document nobody's counsel
 * has read. Homes upload their own; we fill them and route them.
 *
 * Three groups of tables, and the split matters:
 *
 *  - `home_forms` and `home_form_fields` are the blank form. They belong to
 *    the home and are edited by the home.
 *  - `case_forms`, `case_form_answers` and `case_form_flags` are one family's
 *    copy. Answers are one row per box rather than a JSON blob per form,
 *    because the two questions that actually get asked are "which boxes are
 *    still empty" and "who answered this one" — and both are a `where` clause
 *    against rows and an unindexable scan against a blob.
 *  - `case_authorizations` and `case_authorization_consents` are what happens
 *    when the form being completed is the one that says a body may be
 *    cremated. Those are not answers. See the comment above them.
 *
 * `source` is the column that makes pre-need worth anything. A box filled in
 * by the person themselves, four years before they died, has to be able to
 * say so — otherwise their family sits looking at a form that is mysteriously
 * already correct and has no idea whether to trust it.
 */

/* ------------------------------------------------ the seventy-two hours -- */

/**
 * Colorado's death certificate clock, and the whole reason this component is
 * shaped the way it is.
 *
 * SB 23-020 replaced the old five-day window: a certificate of death must now
 * be filed with the State Registrar **within 72 hours of assuming custody**
 * of the body, and before final disposition. Separately, a certifying
 * physician has 72 hours from the moment they are asked through EDRS.
 *
 * **We do not integrate with EDRS and we file nothing.** There is no state
 * API here, no submission, no acknowledgement. What this row holds is the
 * director's own record of when the clock started and when they filed it
 * themselves — which is what lets every screen in the product put the forms
 * that feed the certificate first, and lets a director see on Monday which
 * case is going to be late on Wednesday.
 *
 * Every surface that shows this must say plainly that the home files it. A
 * director who believes this product filed a death certificate for them is a
 * director who finds out otherwise from the registrar.
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
     * clock on Tuesday. Nullable until a director records it, because nothing
     * in this product may invent the fact a legal deadline is measured from.
     */
    custodyTakenAt: timestamp("custody_taken_at"),

    /** When the certifying physician was asked through EDRS. Their 72 hours. */
    edrsRequestedAt: timestamp("edrs_requested_at"),
    /** Who was asked, so the follow-up call has a name on it. */
    certifyingProvider: text("certifying_provider"),

    /**
     * When the *home* filed it. Recorded by the director, after they have
     * filed it themselves, in the state's own system. We are not told this by
     * anybody; a person ticks it.
     */
    filedAt: timestamp("filed_at"),
    filedByUserId: integer("filed_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    /** The state file number, once there is one. Free text; formats differ. */
    stateFileNumber: text("state_file_number"),

    /** What the registrar queried, what is still outstanding. Staff only. */
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("death_certificate_filings_case_unique").on(table.caseId),
    index("death_certificate_filings_home_idx").on(table.funeralHomeId),
  ],
);

/** C.R.S. via SB 23-020: filing, and the physician's certification. */
export const CERTIFICATE_FILING_HOURS = 72;
export const CERTIFYING_PHYSICIAN_HOURS = 72;

const HOUR = 60 * 60 * 1000;

/** When the certificate is due, or null while nobody has recorded custody. */
export function certificateDueAt(
  row: Pick<DeathCertificateFiling, "custodyTakenAt">,
): Date | null {
  return row.custodyTakenAt === null
    ? null
    : new Date(row.custodyTakenAt.getTime() + CERTIFICATE_FILING_HOURS * HOUR);
}

/** When the physician's certification is due, on their own separate clock. */
export function certificationDueAt(
  row: Pick<DeathCertificateFiling, "edrsRequestedAt">,
): Date | null {
  return row.edrsRequestedAt === null
    ? null
    : new Date(row.edrsRequestedAt.getTime() + CERTIFYING_PHYSICIAN_HOURS * HOUR);
}

/* ------------------------------------------------------- the blank form -- */

/** What kind of control a box is. Deliberately small; a form is not a UI. */
export const FORM_FIELD_KINDS = [
  "text",
  "textarea",
  "date",
  "number",
  "select",
  "checkbox",
  "signature",
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

/**
 * Whether completing this document is an *authorisation*.
 *
 * An authorisation is not a form with a stricter permission on it. It is a
 * different kind of record: append-only, carrying the statutory tier the
 * signer claimed, who at the home checked that claim, and — where the tier
 * needs a majority — every single person who consented. See
 * `case_authorizations`.
 *
 * The home still supplies the document. This column only says what completing
 * it means.
 */
export const FORM_KINDS = ["form", "authorization"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/**
 * Where a box's answer can be derived from, so nobody is asked twice.
 *
 * A form that asks a daughter for her mother's date of birth, on a case that
 * already holds it, is a defect. A home picks one of these when it builds the
 * box and the answer arrives already filled and editable — the family's job
 * is to correct, not to type.
 *
 * Deliberately a short closed list rather than a path expression. Every entry
 * here is a fact the case genuinely holds; a home wanting something else gets
 * an empty box, which is honest, rather than a template language.
 */
export const FORM_PREFILL_SOURCES = [
  "decedent.firstName",
  "decedent.lastName",
  "decedent.fullName",
  "decedent.dateOfBirth",
  "decedent.dateOfDeath",
  "vitals.legalFirstName",
  "vitals.legalMiddleName",
  "vitals.legalLastName",
  "vitals.nameAtBirth",
  "vitals.dateOfBirth",
  "vitals.birthCity",
  "vitals.birthState",
  "vitals.motherMaidenName",
  "vitals.fatherLastName",
  "vitals.residenceLine1",
  "vitals.residenceCity",
  "vitals.residenceState",
  "vitals.residencePostalCode",
  "vitals.informantName",
  "vitals.informantRelationship",
  "vitals.informantPhone",
  "home.name",
  "case.serviceAt",
  "contact.name",
  "contact.relationship",
] as const;
export type FormPrefillSource = (typeof FORM_PREFILL_SOURCES)[number];

export const homeFormsTable = pgTable(
  "home_forms",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),

    /** One line under the title: "Required to file the death certificate". */
    note: text("note"),

    /** `form`, or `authorization`. See `FORM_KINDS`. */
    kind: text("kind").notNull().default("form"),

    /**
     * Which family access level may complete it.
     *
     * Set by the home, enforced by the API rather than by the portal hiding a
     * button — see `routes/forms.ts`, which mounts Component 1's
     * `requireFamilyLevel` and `requireFamilyAuthorization` in front of these.
     * An `authorization` is always `authorizing`; the API refuses to store
     * anything else, because a cremation authorisation a cousin could sign is
     * not an authorisation.
     */
    requiredLevel: text("required_level").notNull().default("arranging"),

    /**
     * Whether what this form collects feeds the death certificate.
     *
     * The ordering flag for the 72-hour clock. Forms marked this way are
     * asked for first, shown against the clock, and are what "outstanding"
     * means on a case that is about to be late.
     */
    blocksCertificate: boolean("blocks_certificate").notNull().default(false),

    /**
     * Whether every new case gets this form.
     *
     * A home's library outgrows what any one family needs — a veteran's
     * benefits form matters to one case in twenty. Detached forms stay in the
     * library and can be put on a single case by hand.
     */
    attachByDefault: boolean("attach_by_default").notNull().default(true),

    /**
     * Whether somebody arranging their own funeral is asked this.
     *
     * Off for anything that only makes sense once a person has died. A
     * cremation authorisation is signed by a living relative and cannot be
     * pre-answered; a vital statistics worksheet is almost entirely facts the
     * person knows better than anybody who will survive them.
     */
    inPreNeed: boolean("in_pre_need").notNull().default(false),

    /**
     * The original the home uploaded, kept alongside the boxes.
     *
     * The boxes are what a family fills in; this is the document a state
     * registrar, a coroner or a court expects to see, and throwing it away
     * because we extracted its fields would be throwing away the artefact.
     */
    sourceUploadId: integer("source_upload_id").references(() => uploadsTable.id, {
      onDelete: "set null",
    }),

    position: integer("position").notNull().default(0),

    /**
     * Retired, never deleted. A form a family has already filled in is part of
     * that family's file, and `RETENTION.md` is the home's call — so a home
     * replacing last year's authorisation takes this one out of the library
     * and leaves every case that used it intact.
     */
    retiredAt: timestamp("retired_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_forms_home_idx").on(table.funeralHomeId, table.position),
  ],
);

export const homeFormFieldsTable = pgTable(
  "home_form_fields",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /**
     * A stable handle for the box, unique within its form.
     *
     * Answers are stored against this rather than against the row id, so a
     * home can delete a mis-made box and re-add it without orphaning what a
     * family already typed.
     */
    key: text("key").notNull(),

    label: text("label").notNull(),
    kind: text("kind").notNull().default("text"),

    /** For `select`. Stored newline-separated, which is how it is edited. */
    options: text("options"),

    /** Under the box, in smaller type: "Not 'retired' — what they did." */
    help: text("help"),

    /**
     * Required to consider the form finished — not required to save.
     *
     * Nothing on the family surface ever refuses a partial save. A form that
     * will not let go of a grieving person until they have found their
     * mother's maiden name is a form they abandon on a phone at midnight.
     */
    required: boolean("required").notNull().default(false),

    /**
     * Whether this is a box only the family can answer.
     *
     * The director can find a date of death and a place of birth. Nobody at
     * the funeral home knows how many years of school a man finished or what
     * his mother's name was before she married, and those are the boxes that
     * hold a death certificate up inside its 72 hours. Flagged so that the
     * one thing asked of a family first is the thing that blocks everything
     * else, rather than the forty fields around it.
     */
    onlyFamilyKnows: boolean("only_family_knows").notNull().default(false),

    /** Where the answer can be derived from. See `FORM_PREFILL_SOURCES`. */
    prefillFrom: text("prefill_from"),

    /**
     * Whether this box may hold something a funeral home's insurer would
     * rather it did not.
     *
     * Set on social security numbers, policy numbers and anything else that
     * belongs in the encrypted columns. The API refuses to store a value for
     * a sensitive box in the clear, never reads one back to the family
     * portal, and shows staff the last four characters — the same posture as
     * the social security number in `vital-statistics.ts`, for the same
     * reason: a forwarded link on a kitchen table must not display it.
     */
    sensitive: boolean("sensitive").notNull().default(false),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("home_form_fields_form_idx").on(table.formId, table.position),
    uniqueIndex("home_form_fields_key_idx").on(table.formId, table.key),
  ],
);

/* -------------------------------------------------- one family's copy -- */

/** Which of the home's forms are on this particular case. */
export const caseFormsTable = pgTable(
  "case_forms",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /** The family can see and fill it. Off while a director is preparing it. */
    sharedWithFamily: boolean("shared_with_family").notNull().default(true),

    assignedByUserId: integer("assigned_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    completedAt: timestamp("completed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_forms_unique_idx").on(table.caseId, table.formId),
    index("case_forms_case_idx").on(table.caseId),
  ],
);

/** Who put the answer there. See the note at the top of the file. */
export const ANSWER_SOURCES = ["family", "self", "staff"] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const caseFormAnswersTable = pgTable(
  "case_form_answers",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),

    /** `home_form_fields.key`, not its id. See that column's note. */
    fieldKey: text("field_key").notNull(),

    /**
     * What they wrote.
     *
     * Encrypted at rest when the field is marked `sensitive`, in the same
     * envelope format as everything else — `v1.iv.tag.ciphertext`, so
     * `isEncrypted` can tell without a schema lookup.
     */
    value: text("value").notNull().default(""),

    /** `family`, `self` (pre-need, by the person), or `staff`. */
    source: text("source").notNull().default("family"),

    /**
     * When a pre-need answer was written, which is not when the case was
     * opened and is usually years earlier. Shown to the family, because
     * "he answered this in 2022" is the difference between trusting it and
     * wondering who typed it.
     */
    answeredAt: timestamp("answered_at").notNull().defaultNow(),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_form_answers_unique_idx").on(
      table.caseId,
      table.formId,
      table.fieldKey,
    ),
    index("case_form_answers_case_idx").on(table.caseId),
  ],
);

/**
 * A box a director has sent back, and why.
 *
 * The feature this exists for: a director reads a half-finished form, sees
 * the one box the state will reject the certificate over, and needs to say so
 * to a family who is not going to read a voicemail. The note lands in the
 * family's form, at the blank, rather than anywhere else.
 *
 * Cleared by answering. Not by the director marking it resolved, because the
 * director is not the one who knows when it is done.
 */
export const caseFormFlagsTable = pgTable(
  "case_form_flags",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    formId: integer("form_id")
      .notNull()
      .references(() => homeFormsTable.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),

    /** In the director's own words. Shown to the family verbatim. */
    note: text("note").notNull(),

    raisedByUserId: integer("raised_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    clearedAt: timestamp("cleared_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("case_form_flags_unique_idx").on(
      table.caseId,
      table.formId,
      table.fieldKey,
    ),
    index("case_form_flags_case_idx").on(table.caseId),
  ],
);

/* ----------------------------------------------------- authorisations -- */

/**
 * Somebody said a body may be cremated, and this is the record of it.
 *
 * Not a completed form. A form is a thing a family edits until it is right;
 * this is a statement made at a moment, by a named person, claiming a
 * particular statutory standing, and it has to still say the same thing in
 * two years when a probate lawyer reads it. So:
 *
 *  - **Append-only.** Nothing here is edited after it is written. A mistake
 *    is corrected by recording a second authorisation, never by changing the
 *    first — the whole value of the row is that it is what was signed. The
 *    single exception is the home's own counter-signature below, which can be
 *    added once and never changed.
 *  - **The answers are snapshotted**, not read back out of
 *    `case_form_answers`. Those rows keep moving; this document does not.
 *  - **The claimed tier is stored on the row**, not read off the contact. The
 *    contact's tier is the home's current determination and can be corrected;
 *    what belongs here is what was claimed when the signature was made.
 *
 * Colorado (C.R.S. 15-19-106) sets who may make this statement, and a
 * crematory may not act without documentation that the authorisation complies
 * with Title 15, Article 19. What the software does is record the claim, the
 * verification and the consents. What it never does is decide the claim —
 * that is a funeral director's determination, from documents, and
 * `family-contacts.ts` says why at length.
 */
export const caseAuthorizationsTable = pgTable(
  "case_authorizations",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /**
     * The home's own document this authorises under — their cremation
     * authorisation, their disposition authorisation, whichever their counsel
     * wrote. Required, because there is no such thing here as an
     * authorisation under a form we made up.
     */
    caseFormId: integer("case_form_id")
      .notNull()
      .references(() => caseFormsTable.id, { onDelete: "cascade" }),

    /**
     * Which tier of C.R.S. 15-19-106 the signer claimed — `surviving_spouse`,
     * `adult_children`, and so on. Free text, matching `dispositionTier` on
     * the contact: the statute is amended and a case outlives a deployment.
     */
    claimedTier: text("claimed_tier").notNull(),

    /**
     * Whether that tier needs a majority, as the product read the statute on
     * the day this was signed.
     *
     * Stored rather than derived, and that is deliberate for a row nobody may
     * edit: if we later change our reading, or the statute changes, this row
     * must still say what the home was told at the time.
     */
    requiresMajority: boolean("requires_majority").notNull().default(false),

    /**
     * How many people the *home determined* are in that tier — four surviving
     * adult children, two surviving parents.
     *
     * Nullable, and never computed from anything in this database. It is what
     * lets a screen say "two of four recorded" instead of pretending one
     * signature was a majority. Nothing is refused on it; see
     * `majorityRecorded`.
     */
    tierMemberCount: integer("tier_member_count"),

    /** The family contact who signed, when they signed in the portal. */
    signedByContactId: integer("signed_by_contact_id").references(
      () => familyContactsTable.id,
      { onDelete: "set null" },
    ),
    /** Typed, in their own hand, and kept verbatim. */
    signedName: text("signed_name").notNull(),
    signedRelationship: text("signed_relationship"),
    signedAt: timestamp("signed_at").notNull().defaultNow(),
    /** "Who, what, when, from where" — Section 1's audit requirement. */
    signedIp: text("signed_ip"),

    /**
     * Set when a member of staff recorded an authorisation that was made on
     * paper, across a desk. Most of them still are.
     */
    recordedByUserId: integer("recorded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    /**
     * Who at the home checked the claim, and when.
     *
     * The statute's requirement and the home's protection: a claimed tier
     * nobody verified is a claim, not an authorisation. Added once, never
     * changed.
     */
    verifiedByUserId: integer("verified_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    verifiedAt: timestamp("verified_at"),
    /** What they saw: a marriage certificate, a court order, a driving licence. */
    verificationNote: text("verification_note"),

    /**
     * The answers as they stood at the moment of signing, as JSON. Sensitive
     * boxes are stored here in the same encrypted envelope as everywhere else.
     */
    answersSnapshot: text("answers_snapshot").notNull().default("{}"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_authorizations_case_idx").on(table.caseId, table.signedAt),
    index("case_authorizations_form_idx").on(table.caseFormId),
  ],
);

/**
 * One person who consented, on a tier that needs a majority.
 *
 * This table exists because of one sentence in the statute and one habit in
 * the trade. Where the right of disposition sits with "a majority of the
 * surviving adult children", a single daughter signing a box that says she
 * speaks for a majority is not a majority — it is one signature and a claim.
 * Every consenting person gets a row, with their own name, their own moment
 * and the channel the home heard it through, because that is the difference
 * between a record a crematory can rely on and a sentence somebody typed.
 */
export const caseAuthorizationConsentsTable = pgTable(
  "case_authorization_consents",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    authorizationId: integer("authorization_id")
      .notNull()
      .references(() => caseAuthorizationsTable.id, { onDelete: "cascade" }),

    personName: text("person_name").notNull(),
    /** "Daughter", "eldest son". Their own words, not a dropdown. */
    relationship: text("relationship"),

    /** Set when this person is also in the portal. Most are not. */
    contactId: integer("contact_id").references(() => familyContactsTable.id, {
      onDelete: "set null",
    }),

    /** How the home heard it. See `CONSENT_CHANNELS`. */
    channel: text("channel").notNull().default("in_person"),

    consentedAt: timestamp("consented_at").notNull().defaultNow(),
    signedIp: text("signed_ip"),

    /** Who at the home wrote it down, when it did not come through the portal. */
    recordedByUserId: integer("recorded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_authorization_consents_auth_idx").on(table.authorizationId),
    index("case_authorization_consents_case_idx").on(table.caseId),
  ],
);

/** How a consent reached the home. A telephone consent is still a consent. */
export const CONSENT_CHANNELS = [
  "portal",
  "in_person",
  "telephone",
  "email",
  "paper",
] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/**
 * The tiers of C.R.S. 15-19-106 that are held by a group rather than a person.
 *
 * Used for one thing only: deciding whether the screen asks for more than one
 * consenting person. The tier itself stays free text — see `claimedTier` —
 * and a tier that is not in this list simply does not prompt for a second
 * name. It never decides who may authorise anything.
 */
export const MAJORITY_TIERS = [
  "adult_children",
  "parents",
  "adult_siblings",
] as const;

export function tierRequiresMajority(tier: string): boolean {
  return (MAJORITY_TIERS as readonly string[]).includes(tier.trim());
}

/**
 * Whether a majority has actually been recorded, or `null` when nobody has
 * said how many people are in the tier.
 *
 * Shown, never enforced. The software does not refuse a cremation because it
 * counted to two — a director does, holding what they know about a family
 * that this database does not. What it must never do is let a screen imply a
 * majority exists when what it has is one name.
 */
export function majorityRecorded(
  consentCount: number,
  tierMemberCount: number | null,
): boolean | null {
  if (tierMemberCount === null || tierMemberCount <= 0) return null;
  return consentCount * 2 > tierMemberCount;
}

/* ------------------------------------------------------------- contracts -- */

export const insertHomeFormSchema = createInsertSchema(homeFormsTable)
  .omit({ id: true, funeralHomeId: true, createdAt: true, updatedAt: true })
  .extend({
    kind: z.enum(FORM_KINDS),
    requiredLevel: z.enum(FAMILY_ACCESS_LEVELS),
  });
export type InsertHomeForm = z.infer<typeof insertHomeFormSchema>;
export type HomeForm = typeof homeFormsTable.$inferSelect;

export const insertHomeFormFieldSchema = createInsertSchema(homeFormFieldsTable)
  .omit({ id: true, funeralHomeId: true, formId: true, createdAt: true, updatedAt: true })
  .extend({ kind: z.enum(FORM_FIELD_KINDS) });
export type InsertHomeFormField = z.infer<typeof insertHomeFormFieldSchema>;
export type HomeFormField = typeof homeFormFieldsTable.$inferSelect;

export type CaseForm = typeof caseFormsTable.$inferSelect;
export type CaseFormAnswer = typeof caseFormAnswersTable.$inferSelect;
export type CaseFormFlag = typeof caseFormFlagsTable.$inferSelect;
export type CaseAuthorization = typeof caseAuthorizationsTable.$inferSelect;
export type CaseAuthorizationConsent =
  typeof caseAuthorizationConsentsTable.$inferSelect;
export type DeathCertificateFiling =
  typeof deathCertificateFilingsTable.$inferSelect;

/** `select` options as edited (newline-separated) and as used (a list). */
export function fieldOptions(field: Pick<HomeFormField, "options">): string[] {
  return (field.options ?? "")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Is this form finished?
 *
 * Only `required` boxes count. A form is not unfinished because somebody left
 * the middle name of a stepfather blank, and reporting it as unfinished is how
 * a director stops trusting the indicator entirely.
 */
export function formIsComplete(
  fields: HomeFormField[],
  answers: Map<string, string>,
): boolean {
  return fields
    .filter((f) => f.required)
    .every((f) => (answers.get(f.key) ?? "").trim() !== "");
}

/**
 * The boxes still holding up the death certificate.
 *
 * Required, unanswered, and only the family can supply them. This is the list
 * a director wants at eight in the morning and the list the portal puts at the
 * top of the page — not the forty other blanks around them.
 */
export function blockingFields(
  fields: HomeFormField[],
  answers: Map<string, string>,
): HomeFormField[] {
  return fields.filter(
    (f) =>
      f.required &&
      f.onlyFamilyKnows &&
      (answers.get(f.key) ?? "").trim() === "",
  );
}
