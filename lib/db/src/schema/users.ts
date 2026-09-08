import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Accounts. Everything else in this database hangs off `users.id` and is
 * deleted with it — see the `onDelete: "cascade"` on every `userId` column.
 *
 * `email` is stored already lower-cased (normalised in `lib/auth.ts`) so the
 * unique index below is a true case-insensitive constraint without needing
 * the citext extension.
 *
 * `passwordHash` is nullable because an account created through Google has no
 * password and never needs one. Every flow that used to assume a password
 * exists now has to say what it does when there isn't one — which is the
 * point of leaving the column nullable rather than storing a placeholder.
 */
export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    googleId: text("google_id"),
    /**
     * Whether the address is known to belong to whoever holds the account.
     * Google tells us; a self-registered email is taken on trust for now, and
     * this is the flag a future confirmation step would set.
     */
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name"),
    /**
     * How this account appears in the one shared room, and nowhere else.
     * Assigned on first post when left blank — a parent posting at 3am should
     * not have to invent a username, or accidentally publish under their own
     * name. Unique so nobody can dress as somebody else.
     */
    screenName: text("screen_name"),
    /**
     * Whether this account can hide other people's posts.
     *
     * A public room on a site for bereaved parents needs someone able to
     * remove what turns up in it, and that has to be a real person rather
     * than a heuristic. Granted by hand in the database, never by any route.
     */
    isModerator: boolean("is_moderator").notNull().default(false),
    /**
     * Whether the home page offers the "something you wrote" door at all.
     *
     * On by default, because the door is only a door — nothing is revealed
     * until it is opened. Off means it disappears entirely, for the person who
     * does not want their own writing to be a thing that can arrive.
     */
    resurfacingEnabled: boolean("resurfacing_enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_google_id_unique").on(table.googleId),
    uniqueIndex("users_screen_name_unique").on(table.screenName),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/**
 * A user as the API is allowed to describe it. The hash never leaves the
 * server, and `hasPassword` / `hasGoogle` are what the client actually needs:
 * enough to render the right account controls, without exposing the secret.
 */
export type PublicUser = Omit<User, "passwordHash" | "googleId"> & {
  hasPassword: boolean;
  hasGoogle: boolean;
};

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, googleId, ...rest } = user;
  return {
    ...rest,
    hasPassword: passwordHash !== null,
    hasGoogle: googleId !== null,
  };
}
