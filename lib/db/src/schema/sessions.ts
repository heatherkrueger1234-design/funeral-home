import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Server-side sessions, rather than self-contained JWTs, so that logging out
 * and deleting an account genuinely revoke access instead of leaving a signed
 * token valid until it expires.
 *
 * The primary key is the SHA-256 of the session token, never the token
 * itself: a leaked database dump does not hand out live sessions.
 */
export const sessionsTable = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export type Session = typeof sessionsTable.$inferSelect;
