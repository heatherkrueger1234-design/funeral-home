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

/**
 * The people on the family's side of a case, and their way in.
 *
 * There is no account here, and that is the single most important product
 * decision in this schema. The next of kin is being asked to do admin three
 * days after their mother died; a registration form is where that person is
 * lost. So the director enters a name and a mobile number, the family gets a
 * text with a link, and the link *is* the credential.
 *
 * That trade is made with open eyes. A link in a text message can be
 * forwarded, and anyone holding it is treated as that contact. Three things
 * make it an acceptable trade rather than a careless one:
 *
 *  1. What is behind it is scoped to a single case — photographs of their own
 *     relative, and a hymn list. There is no money, no other family, and no
 *     way to reach the home's other cases.
 *  2. The token is stored only as a SHA-256 digest, so a database dump does
 *     not hand out live links.
 *  3. It expires, and the director can revoke it in one click.
 *
 * Forwarding is also, mostly, the point: the family *wants* the brother in
 * Ohio adding photographs. `canInvite` lets the next of kin pass that on
 * without the director being asked to key in another phone number.
 */
export const familyContactsTable = pgTable(
  "family_contacts",
  {
    id: serial("id").primaryKey(),
    /**
     * Carried here as well as on the case. Redundant — the case already says
     * which home it belongs to — and worth it: every query in this codebase
     * filters on `funeralHomeId` directly, and a table that can only be
     * scoped through a parent is the one shape where somebody eventually
     * writes the query that forgets.
     */
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /** "Daughter", "Son-in-law". Shown beside their name in the chat. */
    relationship: text("relationship"),
    phone: text("phone"),
    email: text("email"),

    /**
     * `next_of_kin` is the person the deadlines belong to and the one the
     * director actually needs answers from. `contributor` is the cousin who
     * was forwarded the link to add photographs. Both can upload; only the
     * next of kin is shown the timeline as *theirs*.
     */
    role: text("role").notNull().default("contributor"),

    /** Whether this contact can generate a link for somebody else. */
    canInvite: boolean("can_invite").notNull().default(false),

    /* ------------------------------------------------- what they may do */

    /**
     * What this person is allowed to do, as distinct from `role`, which is
     * who they are to the deceased. A daughter is the next of kin whether or
     * not she is the one who signs.
     *
     * The three levels are not invented. Colorado sets a statutory priority
     * order for the *right of final disposition* (C.R.S. 15-19-106), and the
     * person holding it is the one whose signature means anything:
     *
     *  `authorizing` — holds the right of final disposition. May do anything
     *                  below, plus complete whatever the home records as an
     *                  authorization.
     *  `arranging`   — brought in by that person or by the director. Uploads,
     *                  writes, fills forms, messages, sees the timeline.
     *  `viewing`     — extended family given the link. Contributes
     *                  photographs, reads what is shared.
     *
     * Defaults to `arranging`, which is what every contact could already do
     * before this column existed.
     */
    accessLevel: text("access_level").notNull().default("arranging"),

    /**
     * Which tier of C.R.S. 15-19-106 this person was recorded under — e.g.
     * `surviving_spouse`, `adult_children`. Free text rather than an enum
     * because the statute is amended and a case outlives a deployment.
     *
     * **The software never works this out.** A funeral director does, from
     * documents, and records what they determined. An app that inferred the
     * right of disposition from a relationship dropdown would be confidently
     * wrong in exactly the cases that end up in front of a probate judge.
     */
    dispositionTier: text("disposition_tier"),
    /** Which member of staff recorded that determination, and when. */
    authorityRecordedByUserId: integer("authority_recorded_by_user_id"),
    authorityRecordedAt: timestamp("authority_recorded_at"),

    /* ------------------------------------------------------- credentials */

    /**
     * Set *after* the link has been followed, never before it.
     *
     * The texted link stays the front door for the reason given above: a
     * registration form is where a bereaved next of kin is lost. A password
     * is what somebody sets once they are already inside, and the director
     * can set an initial one and hand it over on the telephone — which is how
     * a funeral home already does everything else.
     *
     * Required before an `authorizing` contact can complete an authorization.
     * A link in a text message can be forwarded; a signature that says who may
     * bury somebody should need more than holding that message.
     */
    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at"),

    /* -------------------------------------------------------- the link */

    /**
     * SHA-256 of the token in the texted URL. The working value exists in
     * exactly one place: the message that was sent.
     */
    tokenHash: text("token_hash").notNull(),
    /**
     * Generous by design. A tight expiry here does not buy security worth
     * having — the link is one case's photographs — and it does buy a
     * bereaved family hitting a dead link on the morning of the funeral.
     */
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastSeenAt: timestamp("last_seen_at"),
    /** Set the first time the link is opened, so the director can see at a
     * glance whether the text ever landed. */
    firstSeenAt: timestamp("first_seen_at"),

    invitedByUserId: integer("invited_by_user_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("family_contacts_token_hash_unique").on(table.tokenHash),
    index("family_contacts_case_id_idx").on(table.caseId),
    index("family_contacts_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const FAMILY_ROLES = ["next_of_kin", "contributor"] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/**
 * Ordered weakest to strongest, and the order is load-bearing: `atLeast`
 * below compares by index, so anything inserted in the middle changes what
 * existing contacts may do. Append, or think hard.
 */
export const FAMILY_ACCESS_LEVELS = ["viewing", "arranging", "authorizing"] as const;
export type FamilyAccessLevel = (typeof FAMILY_ACCESS_LEVELS)[number];

/**
 * Whether a contact meets a required level.
 *
 * The one place levels are compared. Routes ask this question and never
 * compare strings themselves, because `level === "authorizing"` scattered
 * through handlers is how a check gets written the wrong way round once.
 */
export function atLeast(
  contact: Pick<FamilyContact, "accessLevel">,
  required: FamilyAccessLevel,
): boolean {
  const held = FAMILY_ACCESS_LEVELS.indexOf(contact.accessLevel as FamilyAccessLevel);
  // An unrecognised value in the column is treated as no access at all rather
  // than as the default, because the only way it gets there is by hand.
  if (held === -1) return false;
  return held >= FAMILY_ACCESS_LEVELS.indexOf(required);
}

/**
 * Whether this contact may complete something the home records as an
 * authorization — a cremation authorization, a disposition instruction.
 *
 * Three things, all required, none of them sufficient alone: they hold the
 * right of final disposition, a director recorded *which* statutory tier that
 * was under, and they have a password rather than only a forwarded link.
 */
export function canAuthorize(
  contact: Pick<
    FamilyContact,
    "accessLevel" | "dispositionTier" | "authorityRecordedAt" | "passwordHash"
  >,
): boolean {
  return (
    atLeast(contact, "authorizing") &&
    contact.dispositionTier !== null &&
    contact.authorityRecordedAt !== null &&
    contact.passwordHash !== null
  );
}

/** Long enough to cover the service and the fortnight after it. */
export const FAMILY_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export const insertFamilyContactSchema = createInsertSchema(
  familyContactsTable,
).omit({
  id: true,
  funeralHomeId: true,
  tokenHash: true,
  // Credentials and recorded authority are set through their own routes,
  // which check who is asking. Never from a contact-shaped request body.
  passwordHash: true,
  passwordSetAt: true,
  dispositionTier: true,
  authorityRecordedByUserId: true,
  authorityRecordedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFamilyContact = z.infer<typeof insertFamilyContactSchema>;
export type FamilyContact = typeof familyContactsTable.$inferSelect;

/**
 * A contact as the API may describe them. The digest never leaves the server
 * — including to the director, who gets a fresh link to copy at the moment
 * they ask for one and cannot retrieve it again afterwards.
 */
export type PublicFamilyContact = Omit<
  FamilyContact,
  "tokenHash" | "passwordHash"
> & {
  /** What the client needs in order to render account controls. */
  hasPassword: boolean;
};

export function toPublicFamilyContact(
  contact: FamilyContact,
): PublicFamilyContact {
  const { tokenHash, passwordHash, ...rest } = contact;
  return { ...rest, hasPassword: passwordHash !== null };
}

/** Whether a link is still usable, ignoring who is holding it. */
export function isLinkLive(contact: FamilyContact, now = new Date()): boolean {
  return contact.revokedAt === null && contact.expiresAt > now;
}
