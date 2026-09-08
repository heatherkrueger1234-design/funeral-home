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
 * The memorial, as a list of decisions rather than a form.
 *
 * A funeral is thirty choices made in two days by someone who cannot think,
 * across a desk from a person selling them. This models each choice as its own
 * row so that it can be undecided, decided, or explicitly declined — because
 * "no headstone" and "no grave" are real answers that a form with a headstone
 * field cannot express, and because a parent needs to be able to see what is
 * still open without re-reading everything.
 *
 * `estimatedCost` is per choice and nullable. The running total is the point:
 * funeral costs are quoted item by item precisely so that the sum is never
 * visible until it is signed for.
 */
export const memorialChoicesTable = pgTable(
  "memorial_choices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /**
     * venue, song, poem, reading, speaker, headstone, grave, casket,
     * flowers, jewelry, transport, program, food, other
     */
    category: text("category").notNull(),
    title: text("title").notNull(),
    details: text("details"),
    /** undecided, chosen, declined, done */
    status: text("status").notNull().default("undecided"),
    /**
     * Cents, to avoid the rounding that floating point does to money. Null
     * where a cost is unknown, which is different from free.
     */
    estimatedCost: integer("estimated_cost"),
    /** Who is handling it, if it has been given away. */
    assignedTo: text("assigned_to"),
    /** Kept at the top of the list. */
    isPinned: boolean("is_pinned").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("memorial_choices_user_id_idx").on(table.userId)],
);

export const insertMemorialChoiceSchema = createInsertSchema(
  memorialChoicesTable,
).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMemorialChoice = z.infer<typeof insertMemorialChoiceSchema>;
export type MemorialChoice = typeof memorialChoicesTable.$inferSelect;
