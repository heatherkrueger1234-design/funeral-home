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

/**
 * Obituary drafts.
 *
 * Several rows per account on purpose. Parents write one for the newspaper,
 * one for the service, one they could not send, and one written at four in the
 * morning that says what they actually think. None of those should overwrite
 * each other, and the abandoned ones are frequently the ones they come back
 * for years later.
 *
 * The fields mirror the questions a funeral home asks, in the order it asks
 * them, so that answering them here means arriving with it done instead of
 * composing an obituary across a desk from a stranger on a deadline.
 */
export const obituariesTable = pgTable(
  "obituaries",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** "For the paper", "the one I actually meant". */
    label: text("label").notNull().default("Draft"),
    fullName: text("full_name"),
    nickname: text("nickname"),
    bornDate: text("born_date"),
    diedDate: text("died_date"),
    bornPlace: text("born_place"),
    diedPlace: text("died_place"),
    /**
     * Deliberately optional and deliberately never defaulted. An obituary does
     * not have to name a cause of death, and a form that implies it must is
     * how a grieving parent ends up publishing something they regret.
     */
    causeOfDeath: text("cause_of_death"),
    survivedBy: text("survived_by"),
    precededBy: text("preceded_by"),
    /** School, work, service, the things they did. */
    lifeDetails: text("life_details"),
    /** What they were actually like. The part that matters. */
    personality: text("personality"),
    hobbies: text("hobbies"),
    serviceDetails: text("service_details"),
    /** "In lieu of flowers…" */
    donations: text("donations"),
    /** Anything that did not fit the fields. */
    additional: text("additional"),
    /** The assembled text, once edited by hand. */
    finalText: text("final_text"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("obituaries_user_id_idx").on(table.userId)],
);

export const insertObituarySchema = createInsertSchema(obituariesTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertObituary = z.infer<typeof insertObituarySchema>;
export type Obituary = typeof obituariesTable.$inferSelect;
