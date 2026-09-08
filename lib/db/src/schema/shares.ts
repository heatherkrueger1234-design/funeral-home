import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Read-only public links to one thing.
 *
 * The whole of the rest of this application is private by construction: every
 * query names an owner, and uploads are served by an authenticated handler
 * rather than a static path. A share link is the single deliberate hole in
 * that, so it is built narrow:
 *
 * - It points at exactly one row of one kind. There is no "share everything".
 * - Only the SHA-256 of the token is stored, exactly as sessions are, so a
 *   leaked dump does not hand out working links to strangers.
 * - It can be revoked, and revoking is a real delete rather than a flag, so
 *   there is no path where a revoked link still resolves.
 *
 * The token is shown to its owner once, at creation, and never again. That is
 * a deliberate cost: a parent who loses the link makes a new one, and in
 * exchange nothing on this site can be turned into a public URL by anybody who
 * gets a copy of the database.
 */
export const sharesTable = pgTable(
  "shares",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Which table `resourceId` points into. Currently only "memory". */
    kind: text("kind").notNull(),
    resourceId: integer("resource_id").notNull(),
    /** Shown to the owner so a list of links is not a list of ids. */
    label: text("label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("shares_user_id_idx").on(table.userId),
    index("shares_token_hash_idx").on(table.tokenHash),
  ],
);

export type Share = typeof sharesTable.$inferSelect;
