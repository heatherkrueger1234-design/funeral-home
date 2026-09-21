import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Who at the platform looked at which home, and when.
 *
 * Every other table in this database is scoped to one funeral home, and every
 * query filters on `funeralHomeId` before anything else. The admin console is
 * the one place that deliberately reads across that line, which makes it the
 * most dangerous code in the repository — so it writes a row here every time
 * it does, without exception and without a way to opt out.
 *
 * The point is not catching an intruder; an attacker with the platform
 * session can write to this table too. The point is that the homes are asking
 * us, in a data-processing agreement, what the vendor can see about their
 * families. "Almost nothing, and here is the log of every time anyone looked"
 * is an answer a funeral home's insurer accepts. "Trust us" is not.
 *
 * Note what is *not* recorded: nothing about a decedent, a family member, or
 * a case. A log of cross-tenant reads that itself accumulated cross-tenant
 * personal data would be the same leak wearing a different hat.
 *
 * `detail` does carry the name of a practitioner when one is added or
 * changed, and that is the one deliberate exception. It is not data the
 * platform read out of a home — it is the change the platform admin just
 * made, typed by them, and an audit line saying "updated a practitioner"
 * without saying which one is not an audit line.
 */
export const platformAuditTable = pgTable(
  "platform_audit",
  {
    id: serial("id").primaryKey(),

    /**
     * The platform admin, by the email they signed in with.
     *
     * TODO(C1): Component 1 owns `platform_admins` and its session. When that
     * lands this becomes a foreign key to it. Until then the email is what is
     * actually known at the point of the read, and it is stored rather than
     * joined on purpose — an audit line has to still make sense after the
     * account it refers to is gone.
     */
    actorEmail: text("actor_email").notNull(),

    /** What they did. Short, stable, and enumerated in `admin.ts`. */
    action: text("action").notNull(),

    /**
     * The home that was read. Not a foreign key: deleting a home must not
     * quietly delete the record of who looked at it.
     */
    subjectHomeId: integer("subject_home_id"),
    /** The home's name as it was at the time, so the line reads on its own. */
    subjectHomeName: text("subject_home_name"),

    /** One phrase of context. Never a name, never a case. */
    detail: text("detail"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("platform_audit_created_idx").on(table.createdAt),
    index("platform_audit_home_idx").on(table.subjectHomeId),
  ],
);

export type PlatformAuditEntry = typeof platformAuditTable.$inferSelect;
