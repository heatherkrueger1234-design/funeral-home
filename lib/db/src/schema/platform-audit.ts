import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { platformAdminsTable } from "./platform";

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
     * The platform admin who did it.
     *
     * `restrict` rather than `cascade`: deleting an account must not delete
     * the record of what it did. In practice accounts are deactivated rather
     * than deleted, and this makes the careless version fail loudly.
     */
    adminId: integer("admin_id")
      .notNull()
      .references(() => platformAdminsTable.id, { onDelete: "restrict" }),

    /**
     * And their email, denormalised on purpose.
     *
     * The foreign key above is the truth; this is what makes the line legible
     * a year later without a join, after the address has changed or the
     * account has been deactivated and renamed. An audit line has to still
     * make sense on its own.
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
    index("platform_audit_admin_idx").on(table.adminId),
  ],
);

export type PlatformAuditEntry = typeof platformAuditTable.$inferSelect;
