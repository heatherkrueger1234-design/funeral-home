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
import { familyContactsTable } from "./family-contacts";
import { usersTable } from "./users";

/**
 * Times a director has open, and a family taking one.
 *
 * This replaces four telephone calls with two taps. A director opens windows
 * when they have them; the family takes what it needs; nobody rings the
 * office three times to settle on Thursday at four.
 *
 * What it deliberately is not: a calendar. The home already has one, and
 * synchronising with it is a different product with a different failure mode.
 * This holds the handful of windows a director chose to offer *this week*,
 * and disappears when they are used.
 */

export const SLOT_KINDS = [
  "arrangement",
  "viewing",
  "drop_off",
  "collection",
  "other",
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export const appointmentSlotsTable = pgTable(
  "appointment_slots",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /**
     * Offered to one case, or to anybody the home has a link out to.
     *
     * Null is the useful default: a director opening three slots on Thursday
     * morning does not want to decide in advance which family gets them.
     */
    caseId: integer("case_id").references(() => casesTable.id, { onDelete: "cascade" }),

    kind: text("kind").notNull().default("other"),
    /** "Private viewing, immediate family". What the family reads. */
    label: text("label").notNull(),

    startsAt: timestamp("starts_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(30),

    /** Which room, or which chapel. Shown once it is booked. */
    location: text("location"),

    offeredByUserId: integer("offered_by_user_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),

    /**
     * Taken, and by whom.
     *
     * Both columns, because "the Hale case booked it" is what the director's
     * list needs and "Anne booked it" is what the director says out loud. A
     * booked slot is never deleted by the family — they release it, which
     * puts it back on offer.
     */
    takenByCaseId: integer("taken_by_case_id").references(() => casesTable.id, {
      onDelete: "set null",
    }),
    takenByContactId: integer("taken_by_contact_id").references(
      () => familyContactsTable.id,
      { onDelete: "set null" },
    ),
    takenAt: timestamp("taken_at"),

    /** Withdrawn by the home. Kept rather than deleted so a family that had
     *  it can be told it is gone rather than watching it vanish. */
    withdrawnAt: timestamp("withdrawn_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("appointment_slots_home_idx").on(table.funeralHomeId, table.startsAt),
    index("appointment_slots_case_idx").on(table.caseId),
    index("appointment_slots_taken_idx").on(table.takenByCaseId),
  ],
);

export const insertAppointmentSlotSchema = createInsertSchema(appointmentSlotsTable)
  .omit({
    id: true, funeralHomeId: true, takenByCaseId: true, takenByContactId: true,
    takenAt: true, withdrawnAt: true, createdAt: true, updatedAt: true,
  })
  .extend({ kind: z.enum(SLOT_KINDS), durationMinutes: z.number().int().min(5).max(480) });
export type InsertAppointmentSlot = z.infer<typeof insertAppointmentSlotSchema>;
export type AppointmentSlot = typeof appointmentSlotsTable.$inferSelect;

/** Offerable to this case: not taken, not withdrawn, not in the past. */
export function isOpenTo(slot: AppointmentSlot, caseId: number, now = new Date()): boolean {
  if (slot.takenByCaseId !== null) return false;
  if (slot.withdrawnAt !== null) return false;
  if (slot.startsAt <= now) return false;
  return slot.caseId === null || slot.caseId === caseId;
}
