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

export const journalTable = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    mood: text("mood"),
    entryDate: text("entry_date").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("journal_entries_user_id_idx").on(table.userId)],
);

export const insertJournalSchema = createInsertSchema(journalTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJournal = z.infer<typeof insertJournalSchema>;
export type Journal = typeof journalTable.$inferSelect;
