import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { casesTable } from "./cases";
import { funeralHomesTable } from "./funeral-homes";
import { familyContactsTable } from "./family-contacts";

/**
 * What happens after everyone goes home.
 *
 * Directors want to offer thirty-, sixty- and ninety-day check-ins. Almost
 * none of them manage it, because the staff who would send them are busy with
 * the families whose funerals are this week, and a check-in that arrives
 * three months late is worse than none.
 *
 * So closing a case enrols the family here, and the check-ins go out on their
 * own. The home spends no staff hours and is the name on every one of them —
 * that is the entire pitch, and `brandedAs` is the column that delivers it.
 *
 * Consent is real, not implied. `status` starts at `pending` and an
 * enrolment only becomes `active` when the family says yes; `unsubscribedAt`
 * ends it permanently and immediately. Grief mail nobody asked for is a
 * complaint to the funeral home, which makes the careful version also the
 * commercially correct one.
 */
export const aftercareEnrollmentsTable = pgTable(
  "aftercare_enrollments",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => casesTable.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => familyContactsTable.id, { onDelete: "cascade" }),

    /**
     * Copied from the contact rather than joined, on purpose. This is the one
     * place where the address must survive the case being tidied up, and an
     * enrolment that silently stops working because somebody edited a phone
     * number six weeks ago is the exact failure this feature cannot have.
     */
    email: text("email"),
    phone: text("phone"),

    /**
     * The signature at the foot of every check-in: "Provided in care with
     * Horan & McConaty". Snapshotted at enrolment so that a home changing its
     * trading name does not retroactively rewrite messages already sent.
     */
    brandedAs: text("branded_as").notNull(),

    /**
     * `pending` — closed, not yet consented.
     * `active`  — consented; check-ins are going out.
     * `done`    — the schedule finished.
     */
    status: text("status").notNull().default("pending"),

    /** The clock the offsets are measured from: the day of the service. */
    startsAt: timestamp("starts_at").notNull(),
    consentedAt: timestamp("consented_at"),
    unsubscribedAt: timestamp("unsubscribed_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aftercare_enrollments_contact_unique").on(table.contactId),
    index("aftercare_enrollments_case_id_idx").on(table.caseId),
    index("aftercare_enrollments_status_idx").on(table.status, table.startsAt),
  ],
);

/**
 * One row per check-in that is due or has gone out.
 *
 * Rows are written when the enrolment is created, not when the message sends,
 * so that "what is owed to this family" is a query rather than a calculation
 * over dates. It also makes the sender idempotent: a worker that runs twice
 * finds `sentAt` already set and does nothing, which is the property that
 * stops a bereaved family being sent the same grief email twice.
 */
export const aftercareDeliveriesTable = pgTable(
  "aftercare_deliveries",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => aftercareEnrollmentsTable.id, { onDelete: "cascade" }),

    /** Days after `startsAt`. 30, 60, 90 — and the anniversary at 365. */
    dayOffset: integer("day_offset").notNull(),
    dueAt: timestamp("due_at").notNull(),
    sentAt: timestamp("sent_at"),
    /** Set when a send failed, so a human can see it rather than a silence. */
    failedAt: timestamp("failed_at"),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aftercare_deliveries_enrollment_offset_unique").on(
      table.enrollmentId,
      table.dayOffset,
    ),
    index("aftercare_deliveries_due_idx").on(table.dueAt, table.sentAt),
  ],
);

export const AFTERCARE_STATUSES = ["pending", "active", "done"] as const;
export type AftercareStatus = (typeof AFTERCARE_STATUSES)[number];

/**
 * When the check-ins land.
 *
 * The first is at thirty days for a reason worth writing down: the casseroles
 * stop at about three weeks, and the month mark is when the house goes quiet
 * and everybody else has gone back to work. The anniversary is included
 * because it is the day the family is most certain nobody remembers.
 */
export const AFTERCARE_OFFSETS_DAYS = [30, 60, 90, 365] as const;

export const insertAftercareEnrollmentSchema = createInsertSchema(
  aftercareEnrollmentsTable,
).omit({
  id: true,
  funeralHomeId: true,
  caseId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAftercareEnrollment = z.infer<
  typeof insertAftercareEnrollmentSchema
>;
export type AftercareEnrollment = typeof aftercareEnrollmentsTable.$inferSelect;
export type AftercareDelivery = typeof aftercareDeliveriesTable.$inferSelect;
