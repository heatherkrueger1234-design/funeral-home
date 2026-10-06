import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * The emails anybody can make us send to an address with an account: that
 * somebody tried to register it again, a password reset, a confirmation
 * link, an invitation to a home. One row for each that went, so that one inbox is sent only so many
 * of them — see `lib/email-ceiling.ts` in the API.
 *
 * Before this the only limit was per caller, twenty requests in fifteen
 * minutes, and a few addresses taking turns could mail a stranger all day
 * from our sending domain until the provider suspended it. That would stop
 * every home's password resets, invitations and check-ins with it.
 *
 * The address is kept only as the SHA-256 of its normalised form, which is
 * all a count needs. The address itself is on the account; a table about
 * mail has no reason to hold a second copy of it. Nor a `funeralHomeId`:
 * the ceiling is the inbox's, whichever home the account is at, and no home
 * reads this. Rows are deleted two days on, past the longest window that is
 * counted.
 */
export const sentEmailsTable = pgTable(
  "sent_emails",
  {
    id: serial("id").primaryKey(),
    /** SHA-256 of the normalised address, in hex. Never the address. */
    recipientHash: text("recipient_hash").notNull(),
    /** One of `SENT_EMAIL_KINDS`, each with ceilings of its own. */
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (table) => [
    index("sent_emails_recipient_idx").on(table.recipientHash, table.kind, table.sentAt),
    index("sent_emails_sent_at_idx").on(table.sentAt),
  ],
);

export const SENT_EMAIL_KINDS = [
  "account_exists",
  "password_reset",
  "email_verification",
  "staff_invitation",
] as const;
export type SentEmailKind = (typeof SENT_EMAIL_KINDS)[number];

export type SentEmail = typeof sentEmailsTable.$inferSelect;
