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

export const creativeTable = pgTable(
  "creative_works",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    type: text("type").notNull(), // poem, song, art, other
    mediaUrl: text("media_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("creative_works_user_id_idx").on(table.userId)],
);

export const insertCreativeSchema = createInsertSchema(creativeTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCreative = z.infer<typeof insertCreativeSchema>;
export type Creative = typeof creativeTable.$inferSelect;
