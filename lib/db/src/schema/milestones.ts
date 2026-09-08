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

export const milestonesTable = pgTable(
  "milestones",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    milestoneDate: text("milestone_date").notNull(),
    /**
     * birthday, deathday, anniversary, holiday, graduation, sibling,
     * achievement, memory, healing, other
     */
    type: text("type").notNull(),
    isChildMilestone: boolean("is_child_milestone").notNull().default(true),
    /**
     * Whether this comes round every year.
     *
     * The original model treated a milestone as a single dated event, which is
     * right for "he would have graduated in 2027" and wrong for every date
     * that returns — a birthday, the day they died, the anniversary of
     * something. A non-recurring date that has passed simply stops appearing;
     * a recurring one rolls to its next occurrence.
     */
    recurring: boolean("recurring").notNull().default(false),
    /**
     * How many days ahead to start mentioning it, per date.
     *
     * A dentist appointment wants three days. The anniversary of a child's
     * death wants three weeks, because the dread arrives long before the date
     * and parents describe being ambushed by their own body without knowing
     * why. Null falls back to a default chosen from the type.
     */
    noticeDays: integer("notice_days"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("milestones_user_id_idx").on(table.userId)],
);

export const insertMilestoneSchema = createInsertSchema(milestonesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
});
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestonesTable.$inferSelect;
