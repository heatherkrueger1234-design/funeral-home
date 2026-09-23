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
    /**
     * Set when a relative was added by somebody on the family's side — the
     * `canInvite` path — rather than keyed in by a director. Exactly one of
     * this and `invitedByUserId` is set on a row that has either.
     *
     * Kept on the row, not only in the thread note the invite also leaves,
     * because it is what answers the director's question weeks later ("who
     * is this, and who let them in?") after the thread has locked, and it is
     * what the per-case cap on family invitations counts. Not a foreign key:
     * a contact is revoked, never deleted, so the name it points at stays.
     */
    invitedByContactId: integer("invited_by_contact_id"),
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

/** Long enough to cover the service and the fortnight after it. */
export const FAMILY_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * How many relatives the family's side may add to one case, counted over
 * every family-added row whether or not it is still live — so revoking and
 * re-adding cannot walk round it.
 *
 * Sized for a large family rather than a typical one: a mother of six with
 * grandchildren who all want to add photographs is well inside it. What it
 * stops is a forwarded link being used to mint links by the hundred, each a
 * text message the home pays for and a credential the director never saw.
 * Past it, the director can still add anybody from the console.
 */
export const FAMILY_INVITE_CAP = 20;

export const insertFamilyContactSchema = createInsertSchema(
  familyContactsTable,
).omit({
  id: true,
  funeralHomeId: true,
  tokenHash: true,
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
export type PublicFamilyContact = Omit<FamilyContact, "tokenHash">;

export function toPublicFamilyContact(
  contact: FamilyContact,
): PublicFamilyContact {
  const { tokenHash, ...rest } = contact;
  return rest;
}

/** Whether a link is still usable, ignoring who is holding it. */
export function isLinkLive(contact: FamilyContact, now = new Date()): boolean {
  return contact.revokedAt === null && contact.expiresAt > now;
}
