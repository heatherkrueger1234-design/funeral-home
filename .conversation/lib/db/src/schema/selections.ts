import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * Hymns, readings, music, and the names of the pallbearers.
 *
 * One flexible table rather than four rigid ones. The temptation is to model
 * a pallbearer as its own entity with a phone number and a position in the
 * procession, and it is the wrong instinct: what the director needs is a
 * correctly spelled list they can hand to the printer, and every extra
 * required field is another thing a grieving family has to look up.
 *
 * `kind` keeps them sortable into the right section of the order of service;
 * `value` is the thing itself; `notes` is where "verse 3 omitted" goes.
 */
export const serviceSelectionsTable = pgTable(
  "service_selections",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull(),
    value: text("value").notNull(),
    notes: text("notes"),

    /**
     * Who reads it, carries it, or sings it. Separate from `value` so that
     * "Psalm 23" and "read by her granddaughter Ellie" stay separable when
     * the order of service is typeset.
     */
    attribution: text("attribution"),

    position: integer("position").notNull().default(0),
    /** Null while the family is still deciding; set when staff confirm it. */
    confirmedAt: timestamp("confirmed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("service_selections_case_id_idx").on(
      table.caseId,
      table.kind,
      table.position,
    ),
    index("service_selections_funeral_home_id_idx").on(table.funeralHomeId),
  ],
);

export const SELECTION_KINDS = [
  "hymn",
  "reading",
  "music",
  "pallbearer",
  "eulogist",
  "other",
] as const;
export type SelectionKind = (typeof SELECTION_KINDS)[number];

export const insertServiceSelectionSchema = createInsertSchema(
  serviceSelectionsTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServiceSelection = z.infer<
  typeof insertServiceSelectionSchema
>;
export type ServiceSelection = typeof serviceSelectionsTable.$inferSelect;
