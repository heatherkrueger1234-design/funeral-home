import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Outstanding "confirm this is your address" tokens.
 *
 * The same shape as `password_resets`, and for the same reasons: only the
 * SHA-256 digest is stored, so the row is useless to anyone reading the
 * database, and a spent token is marked rather than deleted so that a link
 * arriving twice is rejected as used instead of looking like it never
 * existed.
 *
 * Why this exists at all, when `users.emailVerified` has been on the table
 * since the beginning: nothing ever set it. Anyone could register any funeral
 * home's name against an address they did not own, and the home's public
 * front door — the page a bereaved family reaches at 2am — went live
 * immediately. See `routes/public.ts` for the one thing verification gates,
 * and for the careful list of things it deliberately does not.
 */
export const emailVerificationsTable = pgTable(
  "email_verifications",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * The address this token was issued for.
     *
     * Kept beside the user id rather than read from the user row at
     * redemption, because a director who mistypes their address, corrects it
     * and then clicks the first email must not end up with the wrong address
     * marked verified.
     */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("email_verifications_user_id_idx").on(table.userId)],
);

export type EmailVerification = typeof emailVerificationsTable.$inferSelect;
