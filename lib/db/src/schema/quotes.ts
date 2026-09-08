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

export const quotesTable = pgTable(
  "quotes_songs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    author: text("author"),
    type: text("type").notNull(), // quote, song
    source: text("source"),
    isFavoriteOfChild: boolean("is_favorite_of_child").notNull().default(false),
    /** Marked by the person as one to see again. */
    isStarred: boolean("is_starred").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("quotes_songs_user_id_idx").on(table.userId)],
);

export const insertQuoteSchema = createInsertSchema(quotesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertQuote = z.infer<typeof insertQuoteSchema>;
export type Quote = typeof quotesTable.$inferSelect;
