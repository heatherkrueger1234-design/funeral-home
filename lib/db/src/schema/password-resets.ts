import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Outstanding "forgot my password" tokens.
 *
 * Stored as a SHA-256 digest for the same reason sessions are: the row is
 * useless to anyone who reads the database, because the value that actually
 * works only ever existed in one email.
 *
 * `usedAt` rather than deletion on redemption, so a token that arrives twice
 * is rejected as spent instead of looking like it never existed — and so a
 * password change has a trail if someone needs to ask what happened.
 */
export const passwordResetsTable = pgTable(
  "password_resets",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("password_resets_user_id_idx").on(table.userId)],
);

export type PasswordReset = typeof passwordResetsTable.$inferSelect;
