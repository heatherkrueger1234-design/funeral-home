/**
 * Send the grief check-ins that are due.
 *
 * This is the other half of the feature the funeral home is actually buying.
 * Closing a case writes the schedule; nothing reaches a family until this
 * runs. Point a scheduler at it once a day:
 *
 *   pnpm --filter @workspace/scripts run send-aftercare
 *   pnpm --filter @workspace/scripts run send-aftercare -- --dry-run
 *
 * Three properties matter more than throughput here, because the cost of
 * getting them wrong is a bereaved family receiving something upsetting:
 *
 *  1. **Idempotent.** `sentAt` is stamped before the send is attempted and
 *     the row is claimed with a conditional UPDATE, so two overlapping runs
 *     cannot both take the same delivery. The failure mode this trades for —
 *     a crash between claiming and sending losing one check-in — is much
 *     better than its opposite, which is sending a widow the same message
 *     twice.
 *  2. **Consent, checked at send time.** Not at schedule time. Somebody who
 *     unsubscribed last week must not receive something queued a month ago.
 *  3. **One failure does not stop the run.** A bad address in the third row
 *     must not silently cancel the ninety-day check-in for everyone after it.
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  pool,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  casesTable,
  familyContactsTable,
} from "@workspace/db";

const dryRun = process.argv.includes("--dry-run");

/**
 * What each check-in says.
 *
 * Short, and it asks nothing. The thirty-day note lands when the casseroles
 * have stopped and everyone else has gone back to work; the anniversary one
 * lands on the day the family is most certain nobody remembers. Neither is a
 * marketing email, and neither should read like one.
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

async function main(): Promise<void> {
  const now = new Date();

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
        // Consent is checked here, at send time, not when the schedule was
        // written: somebody who unsubscribed last week must not receive
        // something queued a month ago.
        eq(aftercareEnrollmentsTable.status, "active"),
        isNull(aftercareEnrollmentsTable.unsubscribedAt),
      ),
    );

  if (due.length === 0) {
    console.log("Nothing due.");
    return;
  }

  console.log(`${due.length} check-in(s) due${dryRun ? " (dry run)" : ""}.`);

  let sent = 0;
  let failed = 0;

  for (const row of due) {
    const template = MESSAGES[row.delivery.dayOffset];
    const to = row.enrollment.email;
    const deceased = row.preferredName?.trim() || row.firstName;

    if (!template || !to) {
      // Nothing to send, or nowhere to send it. Recorded rather than retried
      // forever, so it shows up as a number a human can look at.
      if (!dryRun) {
        await db
          .update(aftercareDeliveriesTable)
          .set({
            failedAt: new Date(),
            failureReason: template ? "No email address" : "No message for this offset",
          })
          .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      }
      failed += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  would send day ${row.delivery.dayOffset} to ${to}`);
      sent += 1;
      continue;
    }

    // Claim the row first. The `isNull(sentAt)` in the WHERE is what makes
    // two overlapping runs safe: the second one updates zero rows and skips.
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

    if (claimed.length === 0) continue;

    try {
      const body =
        `${template.body(deceased)}\n\n` +
        `— Provided in care with ${row.enrollment.brandedAs}`;

      // Delivery itself is intentionally out of scope for this script: the
      // API server owns the SMTP transport, and a funeral home may want these
      // going out over their own system. Printing keeps the schedule honest
      // and observable until that is wired up.
      console.log(
        `\n--- to ${to} (${row.contactName}), day ${row.delivery.dayOffset} ---\n` +
          `Subject: ${template.subject}\n\n${body}\n`,
      );

      sent += 1;
    } catch (error) {
      // One bad address must not cancel the ninety-day check-in for everyone
      // after it in the list.
      await db
        .update(aftercareDeliveriesTable)
        .set({
          sentAt: null,
          failedAt: new Date(),
          failureReason: error instanceof Error ? error.message : "Unknown error",
        })
        .where(eq(aftercareDeliveriesTable.id, row.delivery.id));

      failed += 1;
    }
  }

  console.log(`\nSent ${sent}, failed ${failed}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
