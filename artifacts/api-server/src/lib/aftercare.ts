import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  familyContactsTable,
  AFTERCARE_OFFSETS_DAYS,
  AFTERCARE_TOUCHPOINTS,
  calendarDayIn,
  localMorning,
  type AftercareTouchpoint,
  type Case,
  type FuneralHome,
} from "@workspace/db";

/**
 * Enrol a case's family in the branded grief check-ins.
 *
 * Called once, when the case closes. What it creates is deliberately inert:
 * every enrolment starts `pending`, and nothing is ever sent to a `pending`
 * enrolment. The family says yes in the portal, and only then does the
 * schedule start running.
 *
 * That extra step costs conversions and is not negotiable. Unsolicited grief
 * mail is a complaint to the funeral home, and the home is the customer. The
 * careful version is also the commercially correct one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mid-morning, where the home is, a number of days after the service: the
 * service's own calendar day there, plus the days. Counted in days rather
 * than in milliseconds so a daylight-saving change in between cannot move
 * it onto the day before. See `AFTERCARE_DUE_HOUR`.
 */
export function checkInDueAt(startsAt: Date, dayOffset: number, timeZone: string): Date {
  const { year, month, day } = calendarDayIn(startsAt, timeZone);
  return localMorning(year, month, day + dayOffset, timeZone);
}

export async function enrolCaseInAftercare(
  row: Case,
  home: FuneralHome,
  now = new Date(),
): Promise<void> {
  // The clock runs from the service, because that is the day the family
  // measures everything else from. Without one, from the day it closed.
  const startsAt = row.serviceAt ?? now;

  // Only people who left a way to reach them. A contact with neither an
  // email nor a phone number cannot be checked in on, and a row that could
  // never be delivered would sit in the director's aftercare list looking
  // like a failure.
  //
  // And never the person who died. A file that began as their own plan has
  // them on it as a contact, with their own phone and email, and "thinking
  // of you, a month on" sent to the dead person's inbox, about their own
  // funeral, is exactly the message this product exists not to send.
  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, row.id),
        eq(familyContactsTable.funeralHomeId, home.id),
        eq(familyContactsTable.isSubject, false),
        or(
          isNotNull(familyContactsTable.email),
          isNotNull(familyContactsTable.phone),
        ),
      ),
    );

  if (contacts.length === 0) return;

  const brandedAs = home.aftercareSenderName?.trim() || home.name;

  await db.transaction(async (tx) => {
    for (const contact of contacts) {
      const [enrollment] = await tx
        .insert(aftercareEnrollmentsTable)
        .values({
          funeralHomeId: home.id,
          caseId: row.id,
          contactId: contact.id,
          // Copied, not joined: see the schema comment. An enrolment that
          // silently stopped working because somebody corrected a phone
          // number six weeks ago is the one failure this cannot have.
          email: contact.email,
          phone: contact.phone,
          brandedAs,
          startsAt,
        })
        // Closing a case twice must not enrol the same person twice.
        .onConflictDoNothing({ target: aftercareEnrollmentsTable.contactId })
        .returning();

      if (!enrollment) continue;

      // Deliveries are written up front rather than calculated at send time,
      // which is what makes the sender idempotent: a worker that runs twice
      // finds `sentAt` already set and does nothing. The property that
      // matters is that no family is sent the same grief email twice.
      await tx.insert(aftercareDeliveriesTable).values(
        AFTERCARE_OFFSETS_DAYS.map((dayOffset) => ({
          enrollmentId: enrollment.id,
          dayOffset,
          dueAt: checkInDueAt(startsAt, dayOffset, home.timezone),
        })),
      );
    }
  });
}

/** The touchpoints a home offers, from its comma-separated setting. */
export function offeredTouchpoints(home: Pick<FuneralHome, "aftercareTouchpoints">): AftercareTouchpoint[] {
  const chosen = home.aftercareTouchpoints.split(",").map((part) => part.trim());
  return AFTERCARE_TOUCHPOINTS.filter((kind) => chosen.includes(kind));
}

/**
 * When each offered touchpoint lands in the first year after `startsAt`,
 * or is left out when the case does not know the date or it falls outside
 * the year. Dates of birth and death are calendar days stored at UTC
 * midnight, so they are read in UTC; the note goes at mid-morning on that
 * day where the home is, so "Today would have been her birthday" arrives on
 * her birthday.
 */
export function touchpointDates(
  row: Pick<Case, "dateOfBirth" | "dateOfDeath">,
  startsAt: Date,
  kinds: AftercareTouchpoint[],
  timeZone: string,
): Array<{ kind: AftercareTouchpoint; dueAt: Date }> {
  const atMorning = (year: number, month: number, day: number) =>
    localMorning(year, month, day, timeZone);
  const end = startsAt.getTime() + 365 * DAY_MS;
  const within = (date: Date) => date.getTime() > startsAt.getTime() && date.getTime() <= end;
  const out: Array<{ kind: AftercareTouchpoint; dueAt: Date }> = [];

  const firstAfter = (month: number, day: number): Date | null => {
    for (const year of [startsAt.getUTCFullYear(), startsAt.getUTCFullYear() + 1]) {
      const date = atMorning(year, month, day);
      if (within(date)) return date;
    }
    return null;
  };

  for (const kind of kinds) {
    let dueAt: Date | null = null;
    if (kind === "birthday" && row.dateOfBirth) {
      dueAt = firstAfter(row.dateOfBirth.getUTCMonth(), row.dateOfBirth.getUTCDate());
    } else if (kind === "holidays") {
      // Mid-December: ahead of the season, not on the day.
      dueAt = firstAfter(11, 15);
    } else if (kind === "death_anniversary" && row.dateOfDeath) {
      const date = atMorning(
        row.dateOfDeath.getUTCFullYear() + 1,
        row.dateOfDeath.getUTCMonth(),
        row.dateOfDeath.getUTCDate(),
      );
      dueAt = within(date) ? date : null;
    }
    if (dueAt) out.push({ kind, dueAt });
  }
  return out;
}

/**
 * Write the touchpoint deliveries for an enrolment whose family opted in.
 * Idempotent: an existing row for the same kind and day is left alone.
 */
export async function scheduleTouchpoints(
  enrollment: { id: number; startsAt: Date },
  row: Pick<Case, "dateOfBirth" | "dateOfDeath">,
  home: Pick<FuneralHome, "aftercareTouchpoints" | "timezone">,
): Promise<void> {
  const dates = touchpointDates(row, enrollment.startsAt, offeredTouchpoints(home), home.timezone);
  if (dates.length === 0) return;
  await db
    .insert(aftercareDeliveriesTable)
    .values(
      dates.map(({ kind, dueAt }) => ({
        enrollmentId: enrollment.id,
        kind,
        dayOffset: Math.round((dueAt.getTime() - enrollment.startsAt.getTime()) / DAY_MS),
        dueAt,
      })),
    )
    .onConflictDoNothing();
}

/** An enrolment with its schedule, as the API describes it. */
export async function aftercareForCase(caseId: number, funeralHomeId: number) {
  const enrollments = await db
    .select({
      enrollment: aftercareEnrollmentsTable,
      contactName: familyContactsTable.name,
    })
    .from(aftercareEnrollmentsTable)
    .innerJoin(
      familyContactsTable,
      eq(familyContactsTable.id, aftercareEnrollmentsTable.contactId),
    )
    .where(
      and(
        eq(aftercareEnrollmentsTable.caseId, caseId),
        eq(aftercareEnrollmentsTable.funeralHomeId, funeralHomeId),
      ),
    );

  if (enrollments.length === 0) return [];

  const deliveries = await db
    .select()
    .from(aftercareDeliveriesTable)
    .where(
      inArray(
        aftercareDeliveriesTable.enrollmentId,
        enrollments.map(({ enrollment }) => enrollment.id),
      ),
    );

  const byEnrollment = new Map<number, typeof deliveries>();
  for (const row of deliveries) {
    const list = byEnrollment.get(row.enrollmentId) ?? [];
    list.push(row);
    byEnrollment.set(row.enrollmentId, list);
  }

  return enrollments.map(({ enrollment, contactName }) => ({
    ...enrollment,
    contactName,
    deliveries: (byEnrollment.get(enrollment.id) ?? [])
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map(toDeliveryJson),
  }));
}

/** A delivery as either side sees it. */
export function toDeliveryJson(d: {
  id: number;
  kind: string;
  dayOffset: number;
  dueAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  sentVia: string | null;
}) {
  return {
    id: d.id,
    kind: d.kind,
    dayOffset: d.dayOffset,
    dueAt: d.dueAt,
    sentAt: d.sentVia === "withdrawn" ? null : d.sentAt,
    failedAt: d.failedAt,
    sentVia: d.sentVia,
  };
}
