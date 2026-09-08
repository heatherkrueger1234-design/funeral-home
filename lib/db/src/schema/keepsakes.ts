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
 * Answers to the small questions.
 *
 * The fear this exists for is a specific one, and it is the fear that started
 * this site: that the passwords and the tiny quirks and the sound of their
 * laugh are getting fuzzy. Big writing surfaces do not catch those. Nobody
 * sits down to compose an essay about what their son ordered at a restaurant —
 * but they will answer that question in fifteen seconds if it is put to them.
 *
 * So the unit here is one question and one short answer, and the whole design
 * is built around being answerable on a day when nothing else is possible.
 *
 * `question` is stored alongside `promptId` rather than looked up. The prompt
 * list will be edited over the years — reworded, retired, replaced — and an
 * answer whose question has changed underneath it is worse than no answer.
 * What somebody was actually asked is part of what they wrote.
 */
export const keepsakesTable = pgTable(
  "keepsakes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Which prompt this answers, so the same one is not asked twice. */
    promptId: text("prompt_id").notNull(),
    /** The question exactly as it was put to them. */
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("keepsakes_user_id_idx").on(table.userId)],
);

export const insertKeepsakeSchema = createInsertSchema(keepsakesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKeepsake = z.infer<typeof insertKeepsakeSchema>;
export type Keepsake = typeof keepsakesTable.$inferSelect;
