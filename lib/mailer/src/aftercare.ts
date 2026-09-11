import { and, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  casesTable,
  familyContactsTable,
} from "@workspace/db";
import { sendAftercareEmail, isMailConfigured } from "./index";

/**
 * Sending the grief check-ins that are due.
 *
 * Lives here rather than in the script that used to own it, because nothing
 * was running that script. A feature that only works when a human remembers
 * to type a command is not a feature a funeral home is paying for -- so the
 * same function is now callable from a scheduled HTTP request, from cron,
 * or from the CLI, and all three do exactly this.
 *
 * Three properties matter more than throughput, because the cost of getting
 * them wrong is a bereaved family receiving something upsetting:
 *
 *  1. **Idempotent.** A delivery is claimed with a conditional update before
 *     the send is attempted, so two overlapping runs cannot both take it.
 *     The failure this trades for -- a crash between claiming and sending
 *     losing one check-in -- is much better than its opposite.
 *  2. **Consent is checked at send time**, not when the schedule was written.
 *     Somebody who unsubscribed last week must not receive something queued
 *     a month ago.
 *  3. **One failure does not stop the run.** A bad address in the third row
 *     must not cancel the ninety-day check-in for everyone after it.
 */

const MESSAGES: Record<number, { subject: string; body: (name: string) => string }> = {
  30: {
    subject: "Thinking of you",
    body: (name) =>
      `It has been a month since ${name}'s service.\n\n` +
      `This is often the point when the cards stop arriving and everyone else ` +
      `goes back to their week, which can make it a harder month rather than an ` +
      `easier one. If today is a bad day, that is not a sign anything is going ` +
      `wrong.\n\n` +
      `There is nothing you need to do with this message.`,
  },
  60: {
    subject: "Two months on",
    body: (name) =>
      `Two months since ${name}'s service.\n\n` +
      `Grief is not a line that goes steadily down. A good fortnight followed ` +
      `by a week where you cannot function is the ordinary shape of it, not a ` +
      `setback.\n\n` +
      `If you would like to talk to someone, we can point you to people locally.`,
  },
  90: {
    subject: "Three months on",
    body: (name) =>
      `Three months since ${name}'s service.\n\n` +
      `Some people find this is when the practical work finally stops and the ` +
      `loss itself gets louder. If that is where you are, you are not behind.\n\n` +
      `We are still here, and you are welcome to call.`,
  },
  365: {
    subject: "A year today",
    body: (name) =>
      `A year today since ${name}'s service.\n\n` +
      `Anniversaries are often heavier than the day itself, partly because most ` +
      `people no longer know the date. We do.\n\n` +
      `Thinking of you and your family today.`,
  },
};

export type AftercareRunResult = {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  mailConfigured: boolean;
};

export async function runAftercare(
  options: { dryRun?: boolean; now?: Date; limit?: number } = {},
): Promise<AftercareRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const mailConfigured = isMailConfigured();

  const due = await db
    .select({
      delivery: aftercareDeliveriesTable,
      enrollment: aftercareEnrollmentsTable,
      contactName: familyContactsTable.name,
      firstName: casesTable.decedentFirstName,
      preferredName: casesTable.decedentPreferredName,
    })
    .from(aftercareDeliveriesTable)
    .innerJoin(
      aftercareEnrollmentsTable,
      eq(aftercareEnrollmentsTable.id, aftercareDeliveriesTable.enrollmentId),
    )
    .innerJoin(
      familyContactsTable,
      eq(familyContactsTable.id, aftercareEnrollmentsTable.contactId),
    )
    .innerJoin(casesTable, eq(casesTable.id, aftercareEnrollmentsTable.caseId))
    .where(
      and(
        lte(aftercareDeliveriesTable.dueAt, now),
        isNull(aftercareDeliveriesTable.sentAt),
        isNull(aftercareDeliveriesTable.failedAt),
        eq(aftercareEnrollmentsTable.status, "active"),
        isNull(aftercareEnrollmentsTable.unsubscribedAt),
      ),
    )
    // Bounded, so one very overdue backlog cannot turn a scheduled run into
    // an hour-long request that the scheduler kills half-way through.
    .limit(options.limit ?? 200);

  const result: AftercareRunResult = {
    due: due.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    dryRun,
    mailConfigured,
  };

  if (due.length === 0) return result;

  for (const row of due) {
    const template = MESSAGES[row.delivery.dayOffset];
    const to = row.enrollment.email;
    const deceased = row.preferredName?.trim() || row.firstName;

    if (!template || !to) {
      if (!dryRun) {
        await db
          .update(aftercareDeliveriesTable)
          .set({
            failedAt: now,
            failureReason: template
              ? "No email address"
              : "No message for this offset",
          })
          .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      }
      result.failed += 1;
      continue;
    }

    if (dryRun || !mailConfigured) {
      result.skipped += 1;
      continue;
    }

    // Claim first. The `isNull(sentAt)` predicate is what makes two
    // overlapping runs safe: the second updates zero rows and moves on.
    const claimed = await db
      .update(aftercareDeliveriesTable)
      .set({ sentAt: new Date() })
      .where(
        and(
          eq(aftercareDeliveriesTable.id, row.delivery.id),
          isNull(aftercareDeliveriesTable.sentAt),
        ),
      )
      .returning({ id: aftercareDeliveriesTable.id });

    if (claimed.length === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      await sendAftercareEmail({
        to,
        subject: template.subject,
        body: template.body(deceased),
        brandedAs: row.enrollment.brandedAs,
      });
      result.sent += 1;
    } catch (error) {
      await db
        .update(aftercareDeliveriesTable)
        .set({
          sentAt: null,
          failedAt: new Date(),
          failureReason:
            error instanceof Error ? error.message : "Unknown error",
        })
        .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      result.failed += 1;
    }
  }

  /*
   * An enrolment whose whole schedule has been dealt with is finished, so
   * the director's aftercare list shows who is still being written to rather
   * than everyone who ever was.
   *
   * Written as a plain per-enrolment check rather than one clever statement:
   * this runs for a handful of rows on a schedule nobody is watching, and
   * being obviously correct matters more here than being one query.
   */
  if (!dryRun) {
    const enrollmentIds = [...new Set(due.map((row) => row.enrollment.id))];

    for (const enrollmentId of enrollmentIds) {
      const [outstanding] = await db
        .select({ id: aftercareDeliveriesTable.id })
        .from(aftercareDeliveriesTable)
        .where(
          and(
            eq(aftercareDeliveriesTable.enrollmentId, enrollmentId),
            isNull(aftercareDeliveriesTable.sentAt),
            isNull(aftercareDeliveriesTable.failedAt),
          ),
        )
        .limit(1);

      if (outstanding) continue;

      await db
        .update(aftercareEnrollmentsTable)
        .set({ status: "done", updatedAt: now })
        .where(
          and(
            eq(aftercareEnrollmentsTable.id, enrollmentId),
            eq(aftercareEnrollmentsTable.status, "active"),
          ),
        );
    }
  }

  return result;
}
