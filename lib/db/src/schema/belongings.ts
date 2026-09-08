import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * Who has what.
 *
 * Two things are happening in one table, because in practice they are the same
 * conversation. A parent giving away their child's things needs a record of
 * where each thing went — partly so it can be asked for back, mostly because
 * "who has his jacket" becomes an unanswerable question within a year. And the
 * people around them keep asking for something of his, and those requests
 * arrive at random, verbally, in the middle of a funeral, and are forgotten.
 *
 * So `status` covers the whole life of an object: still here, promised to
 * someone, gone to them, or something a person has asked for and no decision
 * has been made about. Nothing is ever deleted by giving it away.
 */
export const belongingsTable = pgTable(
  "belongings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "His leather jacket". */
    item: text("item").notNull(),
    /** kept, promised, given, requested */
    status: text("status").notNull().default("kept"),
    /** Who has it, or who asked for it. Null while it is simply still here. */
    person: text("person"),
    /** Their relationship, so a name alone is not the only record. */
    relationship: text("relationship"),
    /** When it changed hands. */
    givenDate: text("given_date"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("belongings_user_id_idx").on(table.userId)],
);

export const insertBelongingSchema = createInsertSchema(belongingsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBelonging = z.infer<typeof insertBelongingSchema>;
export type Belonging = typeof belongingsTable.$inferSelect;
