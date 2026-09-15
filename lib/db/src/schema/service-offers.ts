import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";

/**
 * Two or three times the home can actually do, for the family to pick from.
 *
 * This is the phone call that never gets made cleanly. The director rings on
 * Tuesday with "Friday at eleven, or Saturday at two", reaches a son who has
 * to ask his sister, the sister rings back to the office while he is driving,
 * and two days later somebody arrives at the wrong hour. The offer is
 * verbal, held in one person's head, and there is no record of what was said.
 *
 * So the options are written down instead, and the family answers them at
 * whatever hour they are awake and together. Deliberately *offers*, not a
 * booking system: this table knows nothing about whether the church is free
 * or the crematorium has a slot. The director confirms those the way they
 * always have, and writes here only what they have already confirmed they
 * can do — which is why `cases.serviceAt` stays "confirmed, not proposed"
 * and why nothing here touches it until a family chooses.
 *
 * Choosing is the moment the case comes to life: it sets the service date,
 * and the service date is what fires the home's standard schedule. A family
 * who picks a time on Tuesday night has a dated timeline on Tuesday night,
 * without a director touching it.
 */
export const caseServiceOffersTable = pgTable(
  "case_service_offers",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),

    startsAt: timestamp("starts_at").notNull(),

    /**
     * Per option, because the choice is usually between places as much as
     * between times — the chapel on Friday or the graveside on Saturday.
     * Null falls back to whatever the case already says.
     */
    location: text("location"),

    /**
     * The sentence the director would have said on the telephone. "Father
     * Reilly can do this one", "this is the last slot before the holiday".
     * It is what makes an option a recommendation rather than a row.
     */
    note: text("note"),

    position: integer("position").notNull().default(0),

    /**
     * When the family picked this one, and who. Null on every option until
     * one is chosen, and then set on exactly one of them — see the index
     * below, which is what actually makes that true.
     */
    chosenAt: timestamp("chosen_at"),
    chosenByContactId: integer("chosen_by_contact_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("case_service_offers_case_idx").on(table.caseId, table.position),
    index("case_service_offers_home_idx").on(table.funeralHomeId),
    /**
     * One chosen time per case, enforced by the database rather than by the
     * handler that happens to write it.
     *
     * Two family members opening the portal on two phones and tapping
     * different times within the same second is not a hypothetical — it is
     * a brother and a sister in the same kitchen. Without this, both writes
     * succeed, `cases.serviceAt` ends up as whichever lost the race, and the
     * portal shows a funeral at an hour nobody agreed to.
     */
    uniqueIndex("case_service_offers_one_choice")
      .on(table.caseId)
      .where(sql`${table.chosenAt} is not null`),
  ],
);

export const insertCaseServiceOfferSchema = createInsertSchema(
  caseServiceOffersTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCaseServiceOffer = z.infer<
  typeof insertCaseServiceOfferSchema
>;
export type CaseServiceOffer = typeof caseServiceOffersTable.$inferSelect;

/** How many options a family can hold in their head at once. */
export const MAX_SERVICE_OFFERS = 5;
