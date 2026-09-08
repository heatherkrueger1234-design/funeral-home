import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  familyContactsTable,
  AFTERCARE_OFFSETS_DAYS,
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
  const contacts = await db
    .select()
    .from(familyContactsTable)
    .where(
      and(
        eq(familyContactsTable.caseId, row.id),
        eq(familyContactsTable.funeralHomeId, home.id),
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
          dueAt: new Date(startsAt.getTime() + dayOffset * DAY_MS),
        })),
      );
    }
  });
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
    deliveries: (byEnrollment.get(enrollment.id) ?? []).map((d) => ({
      id: d.id,
      dayOffset: d.dayOffset,
      dueAt: d.dueAt,
      sentAt: d.sentAt,
      failedAt: d.failedAt,
    })),
  }));
}
