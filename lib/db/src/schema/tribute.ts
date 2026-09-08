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

export const tributeTable = pgTable(
  "tribute",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    obituary: text("obituary"),
    eulogy: text("eulogy"),
    funeralDetails: text("funeral_details"),
    memorialDetails: text("memorial_details"),
    speechNotes: text("speech_notes"),
    burialLocation: text("burial_location"),
    funeralHome: text("funeral_home"),
    funeralDate: text("funeral_date"),
    funeralCost: text("funeral_cost"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("tribute_user_id_idx").on(table.userId)],
);

export const insertTributeSchema = createInsertSchema(tributeTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTribute = z.infer<typeof insertTributeSchema>;
export type Tribute = typeof tributeTable.$inferSelect;
