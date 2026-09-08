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

export const lettersTable = pgTable(
  "letters",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    direction: text("direction").notNull(), // to_child, from_child, received
    author: text("author"),
    letterDate: text("letter_date"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("letters_user_id_idx").on(table.userId)],
);

export const insertLetterSchema = createInsertSchema(lettersTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLetter = z.infer<typeof insertLetterSchema>;
export type Letter = typeof lettersTable.$inferSelect;
