import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Who at the vendor may look across the tenant boundary.
 *
 * This replaces `PLATFORM_ADMIN_EMAILS`, which was a stand-in with two real
 * costs. Granting a colleague access meant a redeploy, and revoking it after
 * somebody left meant the same — so in practice the list went stale, which is
 * the one thing an access list must not do. And an environment variable
 * leaves no trace: "who could see our families' files last March" had no
 * answer, and that is a question a funeral home's insurer asks.
 *
 * Keyed on the address rather than a user id, deliberately. Access can be
 * granted before that person has an account, revoking it does not depend on
 * finding the right row in `users`, and the address is what `platform_audit`
 * records — so the log and the list can be read against each other.
 *
 * Being on this list still grants nothing on its own. A platform admin is a
 * signed-in staff account that is *also* named here: one way to authenticate
 * in this application, one cookie to protect. That is an additional condition
 * and never an alternative one.
 *
 * `revokedAt` rather than deletion, so that the log of who had access when
 * survives somebody being taken off it.
 */
export const platformAdminsTable = pgTable(
  "platform_admins",
  {
    id: serial("id").primaryKey(),
    /** Lower-cased, the same normalisation `users.email` gets. */
    email: text("email").notNull(),
    /** A name to put in the list, when the address is not self-explanatory. */
    displayName: text("display_name"),
    /**
     * Who added them. An address rather than a foreign key because the first
     * row is written by the bootstrap below, where there is no actor yet.
     */
    addedByEmail: text("added_by_email"),
    /** Why, in the operator's own words. Optional, and usually worth having. */
    note: text("note"),
    revokedAt: timestamp("revoked_at"),
    revokedByEmail: text("revoked_by_email"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_admins_email_key").on(table.email)],
);

export type PlatformAdmin = typeof platformAdminsTable.$inferSelect;
