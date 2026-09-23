import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What is due, and when. The antidote to funeral fog.
 *
 * Grieving people lose days. They are not being difficult when the clothing
 * does not arrive and the prayer card proof goes unapproved — they genuinely
 * cannot hold a schedule in their head that week, and the cost of that lands
 * on the home as a delayed service and a scramble at the printer.
 *
 * So the family is shown a short, dated, human list. Deliberately short: this
 * is not a project plan, and a family shown thirty tasks will read none of
 * them. Four or five things, each with a real time and a plain sentence.
 *
 * `isEvent` separates "you must do this by Tuesday" from "the service is at
 * one on Friday". Both belong on the same timeline — the family reads it as
 * one week — but only one of them can be marked done, and rendering the
 * funeral itself with a checkbox beside it would be grotesque.
 */
export const caseDeadlinesTable = pgTable(
  "case_deadlines",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    /** "Deliver clothing to the funeral home". Imperative, and specific. */
    title: text("title").notNull(),
    /** Where, who to ask for, what counts as done. */
    description: text("description"),

    dueAt: timestamp("due_at").notNull(),

    /** A thing that happens rather than a thing to do. Never completable. */
    isEvent: boolean("is_event").notNull().default(false),

    completedAt: timestamp("completed_at"),
    /** Whichever side ticked it off. */
    completedByUserId: integer("completed_by_user_id"),
    completedByContactId: integer("completed_by_contact_id"),

    position: integer("position").notNull().default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_deadlines_case_id_idx").on(table.caseId, table.dueAt),
    index("case_deadlines_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const insertCaseDeadlineSchema = createInsertSchema(
  caseDeadlinesTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCaseDeadline = z.infer<typeof insertCaseDeadlineSchema>;
export type CaseDeadline = typeof caseDeadlinesTable.$inferSelect;
