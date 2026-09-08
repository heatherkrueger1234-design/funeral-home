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

export const memoriesTable = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    category: text("category"),
    dateTaken: text("date_taken"),
    tags: text("tags"),
    isAiGenerated: boolean("is_ai_generated").notNull().default(false),
    /**
     * Marked by the person as one to see again.
     *
     * Which memories are treasures is not a judgement a machine can make about
     * somebody else's dead child, so it is not made by one — the resurfacing
     * draw is weighted by this flag and nothing else.
     */
    isStarred: boolean("is_starred").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("memories_user_id_idx").on(table.userId)],
);

export const insertMemorySchema = createInsertSchema(memoriesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type Memory = typeof memoriesTable.$inferSelect;
