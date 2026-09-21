import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { funeralHomesTable } from "./funeral-homes";

/**
 * Staff accounts: directors, and whoever else at the home works cases.
 *
 * Note who is *not* in this table. Families never get an account. They arrive
 * through a texted link and are identified by a token (see `family_contacts`),
 * because the single fastest way to lose a grieving family at the door is to
 * ask them to choose a password. Everything in here is somebody who works at
 * a funeral home and is paid to be here.
 *
 * `funeralHomeId` is the tenant boundary. It is read off this row after the
 * session resolves and is the only source of tenancy the API trusts — a home
 * id arriving in a request body or a URL is never enough to reach data.
 */
export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** Stored already lower-cased, so the unique index below is truly
     * case-insensitive without needing the citext extension. */
    passwordHash: text("password_hash"),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name"),
    /**
     * How the family sees them signed. "Karen" is colder than "Karen Voss,
     * Funeral Director", and the family is reading it on the worst week of
     * their life.
     */
    title: text("title"),
    /**
     * `owner` can change billing and invite staff; `director` and `staff`
     * differ only in that a director is offered as a case's lead. Roles are
     * intentionally few — a funeral home has eight employees, not a
     * permissions matrix.
     */
    role: text("role").notNull().default("director"),
    /**
     * Cleared rather than deleted when somebody leaves, so the cases they
     * handled keep a real name against them.
     */
    deactivatedAt: timestamp("deactivated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const USER_ROLES = ["owner", "director", "staff"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/**
 * A staff member as the API describes them. The hash never leaves the server;
 * `hasPassword` is what the client actually needs to render account controls.
 */
export type PublicUser = Omit<User, "passwordHash"> & {
  hasPassword: boolean;
};

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  return { ...rest, hasPassword: passwordHash !== null };
}

/**
 * How a staff member is shown to a *family* — a name and a title, nothing
 * else. Their email address is not the family's business, and a case chat
 * that leaked it would put the director's inbox back in the loop that this
 * product exists to close.
 */
export type StaffSignature = {
  displayName: string | null;
  title: string | null;
};

export function toStaffSignature(user: User): StaffSignature {
  return { displayName: user.displayName, title: user.title };
}
