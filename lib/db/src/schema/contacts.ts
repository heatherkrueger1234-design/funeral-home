import {
  pgTable,
  text,
  serial,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * The people who have to be told.
 *
 * The point of this table is that the parent should not be the one making the
 * calls. `toldBy` records who actually did it, so the list can be handed to a
 * sibling or a friend and worked through by somebody else — which is the
 * single most delegable job in the first week and almost never gets delegated,
 * because there is no list to hand over.
 *
 * It is also a defence against the worst version of this: a cousin, or a
 * coach, or an old friend finding out from Facebook a fortnight later.
 */
export const contactsTable = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** family, friend, school, work, medical, official, other */
    category: text("category").notNull().default("other"),
    relationship: text("relationship"),
    phone: text("phone"),
    email: text("email"),
    told: boolean("told").notNull().default(false),
    toldDate: text("told_date"),
    /** Who made the call, when it was not the parent. */
    toldBy: text("told_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("contacts_user_id_idx").on(table.userId)],
);

export const insertContactSchema = createInsertSchema(contactsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
