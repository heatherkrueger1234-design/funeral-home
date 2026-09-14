import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Us. The people who run this business, as opposed to the people who run a
 * funeral home.
 *
 * This is a separate table from `users`, and the separation is the point.
 * `users.funeralHomeId` is `NOT NULL` and is the tenant boundary the entire
 * API depends on: every staff query filters on the home read off the
 * signed-in user's own row. Adding a nullable tenant to that table so a
 * platform admin could live in it would weaken the single strongest invariant
 * in this codebase, and it would weaken it in the one place nobody would
 * notice until a home saw another home's families.
 *
 * So a platform admin is a different kind of thing, in a different table,
 * with a different session and a different cookie, resolved by different
 * middleware. There is no value of `users.role` that grants cross-tenant
 * access, and there never should be.
 */
export const platformAdminsTable = pgTable(
  "platform_admins",
  {
    id: serial("id").primaryKey(),
    /** Stored already lower-cased, so the unique index is truly case-insensitive. */
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    /**
     * `owner` is the business. `support` is somebody helping homes, and is
     * the role that exists so that helping does not require handing over the
     * ability to delete a customer.
     *
     * Two roles, because this is a company of one or two people and a
     * permissions matrix would be fiction.
     */
    role: text("role").notNull().default("support"),
    /** Cleared rather than deleted, so audit rows keep a real name against them. */
    deactivatedAt: timestamp("deactivated_at"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_admins_email_unique").on(table.email)],
);

export const PLATFORM_ROLES = ["owner", "support"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Sessions for the above. A separate table from `sessions` for the same
 * reason the accounts are separate: `resolveSession` must not be able to
 * return a platform admin, and `resolvePlatformSession` must not be able to
 * return a director, whatever anybody later does to either function.
 */
export const platformSessionsTable = pgTable(
  "platform_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => platformAdminsTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("platform_sessions_admin_id_idx").on(table.adminId)],
);

/*
 * The audit of cross-tenant reads lives in `platform-audit.ts`, which
 * Component 2 wrote against the console that actually does the reading. It
 * records the actor's email and the home's name rather than only their ids,
 * so a line still reads after either is gone — which is the right shape, and
 * not the one this file originally had.
 */

export const insertPlatformAdminSchema = createInsertSchema(
  platformAdminsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlatformAdmin = z.infer<typeof insertPlatformAdminSchema>;
export type PlatformAdmin = typeof platformAdminsTable.$inferSelect;
export type PlatformSession = typeof platformSessionsTable.$inferSelect;

/** The hash never leaves the server. */
export type PublicPlatformAdmin = Omit<PlatformAdmin, "passwordHash"> & {
  hasPassword: boolean;
};

export function toPublicPlatformAdmin(admin: PlatformAdmin): PublicPlatformAdmin {
  const { passwordHash, ...rest } = admin;
  return { ...rest, hasPassword: passwordHash !== null };
}

/** Whether this admin may change things rather than only look at them. */
export function canAdminister(admin: Pick<PlatformAdmin, "role">): boolean {
  return admin.role === "owner";
}
