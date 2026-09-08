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

export const affirmationsTable = pgTable(
  "affirmations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    author: text("author"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("affirmations_user_id_idx").on(table.userId)],
);

export const insertAffirmationSchema = createInsertSchema(
  affirmationsTable,
).omit({ id: true, userId: true, createdAt: true });
export type InsertAffirmation = z.infer<typeof insertAffirmationSchema>;
export type Affirmation = typeof affirmationsTable.$inferSelect;
