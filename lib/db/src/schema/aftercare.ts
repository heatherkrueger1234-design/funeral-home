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
    /** When the family also asked for the notes by text. Re-checked at send. */
    smsConsentAt: timestamp("sms_consent_at"),
    /** When they opted in to the birthday/holiday/death-anniversary notes. */
    touchpointsConsentAt: timestamp("touchpoints_consent_at"),

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

    /**
     * `checkin` (30/60/90/365 days after the service) or an opt-in
     * touchpoint: `birthday`, `holidays`, `death_anniversary`.
     */
    kind: text("kind").notNull().default("checkin"),
    /** Days after `startsAt`. 30, 60, 90 — and the anniversary at 365. */
    dayOffset: integer("day_offset").notNull(),
    dueAt: timestamp("due_at").notNull(),
    sentAt: timestamp("sent_at"),
    /** Set when a send failed, so a human can see it rather than a silence. */
    failedAt: timestamp("failed_at"),
    failureReason: text("failure_reason"),
    /** `email`, `sms`, `email,sms`, or `withdrawn` when consent lapsed. */
    sentVia: text("sent_via"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aftercare_deliveries_enrollment_kind_offset_unique").on(
      table.enrollmentId,
      table.kind,
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

/**
 * Extra notes a home may offer and a family may opt in to, each once in the
 * first year: the person's birthday, the first holiday season, and the
 * anniversary of the death itself.
 */
export const AFTERCARE_TOUCHPOINTS = ["birthday", "holidays", "death_anniversary"] as const;
export type AftercareTouchpoint = (typeof AFTERCARE_TOUCHPOINTS)[number];

/** Keys for a home's own wording: the check-in offsets and the touchpoints. */
export const AFTERCARE_COPY_KEYS = ["30", "60", "90", "365", ...AFTERCARE_TOUCHPOINTS] as const;
export type AftercareCopyKey = (typeof AFTERCARE_COPY_KEYS)[number];
export type AftercareCopy = Partial<Record<AftercareCopyKey, { subject: string; body: string }>>;

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

/* ------------------------------------------------- when a message goes -- */

/*
 * Every check-in and every note falls due at mid-morning, in the home's own
 * time zone, on the calendar day it is about, and goes out only between
 * nine in the morning and seven in the evening there.
 *
 * They used to fall due at the time of day the service was held (check-ins)
 * or at 15:00 UTC (notes), and the sender ran once a day at 14:00 UTC. So
 * anything due after two in the afternoon UTC waited until the next day:
 * "Today would have been Eleanor's birthday" arrived the day after her
 * birthday, and the run itself landed at six in the morning on the Pacific
 * coast. The sender now runs hourly and keeps to these hours.
 */
export const AFTERCARE_DUE_HOUR = 10;
export const AFTERCARE_SEND_FROM_HOUR = 9;
export const AFTERCARE_SEND_UNTIL_HOUR = 19;
/** Where a home with an unusable time zone is assumed to be. */
const FALLBACK_ZONE = "America/Denver";

function usableZone(timeZone: string | null | undefined): string {
  if (!timeZone) return FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** The wall clock in a time zone at an instant. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: usableZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** The calendar day an instant falls on, where the home is. */
export function calendarDayIn(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const { year, month, day } = wallClock(at, timeZone);
  return { year, month, day };
}

/** The hour of the day an instant is, where the home is. */
export function hourIn(at: Date, timeZone: string): number {
  return wallClock(at, timeZone).hour;
}

/**
 * Mid-morning on a calendar day, where the home is, as an instant. `month`
 * counts from 0, and a day past the month's end rolls over, as Date.UTC's
 * does, so a day can be found by adding to it.
 */
export function localMorning(year: number, month: number, day: number, timeZone: string): Date {
  const target = Date.UTC(year, month, day, AFTERCARE_DUE_HOUR);
  // Guess, see what the clock there says, and correct; twice, so a guess
  // that lands across a daylight-saving change still comes out right.
  let instant = target;
  for (let i = 0; i < 2; i += 1) {
    const seen = wallClock(new Date(instant), timeZone);
    const shown = Date.UTC(seen.year, seen.month, seen.day, seen.hour, seen.minute, seen.second);
    instant += target - shown;
  }
  return new Date(instant);
}

/** Whether a message may go out now, where the home is. */
export function isAftercareHour(at: Date, timeZone: string): boolean {
  const hour = hourIn(at, timeZone);
  return hour >= AFTERCARE_SEND_FROM_HOUR && hour < AFTERCARE_SEND_UNTIL_HOUR;
}
