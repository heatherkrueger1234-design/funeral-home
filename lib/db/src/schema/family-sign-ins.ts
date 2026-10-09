import { pgTable, text, integer, serial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * A family member asking, from the web page, to be let back in.
 *
 * The usual way in is the link in a text message. People lose it, open it on
 * the wrong device, or find the page by typing the address, and until this
 * existed the only answer was "telephone the funeral home". This is the
 * other answer: type the mobile number or email address the home has on
 * file, and a six-digit code is sent to it.
 *
 * Two things shape the table.
 *
 *  - A row is written for every request, whether or not the number or address
 *    is on any file. What happens next (a code sent, or nothing) is decided
 *    after the answer has gone, so the response says nothing about who the
 *    home knows.
 *  - Nothing here opens a case. A correct code is exchanged for a fresh link
 *    on the contact's own row, exactly as the director's "send a new link"
 *    does, so every limit on a link (expiry, revocation) still holds.
 *
 * Both the handle the browser keeps and the code are stored as digests. The
 * code is six digits and so guessable from its digest alone; what protects
 * it is that it lives for ten minutes and dies after a handful of wrong
 * tries.
 */
export const familySignInsTable = pgTable(
  "family_sign_ins",
  {
    id: serial("id").primaryKey(),
    /** SHA-256 of the handle the browser holds between asking and answering. */
    challengeHash: text("challenge_hash").notNull().unique(),
    /** `phone` (normalised to E.164) or `email` (lower-cased). */
    kind: text("kind").notNull(),
    identifier: text("identifier").notNull(),
    /** SHA-256 of the handle and the code together. Null when none was sent. */
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    /** The right code was given. A choice between files may still be pending. */
    verifiedAt: timestamp("verified_at"),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("family_sign_ins_identifier_idx").on(table.identifier, table.createdAt),
  ],
);

export type FamilySignIn = typeof familySignInsTable.$inferSelect;

/** How long a code is good for. */
export const FAMILY_SIGN_IN_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed before the code is void. */
export const FAMILY_SIGN_IN_MAX_ATTEMPTS = 5;
/** Codes sent to one number or address in an hour, however many ask. */
export const FAMILY_SIGN_INS_PER_IDENTIFIER_PER_HOUR = 5;
