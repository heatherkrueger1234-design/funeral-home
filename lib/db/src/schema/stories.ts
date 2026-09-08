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

export const storiesTable = pgTable(
  "stories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    relationship: text("relationship"),
    content: text("content").notNull(),
    title: text("title"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("stories_user_id_idx").on(table.userId)],
);

export const insertStorySchema = createInsertSchema(storiesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertStory = z.infer<typeof insertStorySchema>;
export type Story = typeof storiesTable.$inferSelect;
