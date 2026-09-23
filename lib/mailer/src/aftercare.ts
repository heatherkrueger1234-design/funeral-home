import { and, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  casesTable,
  familyContactsTable,
  funeralHomesTable,
  usersTable,
  memoryBooksTable,
  FAMILY_LINK_TTL_MS,
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
 *  3. **One failure does not stop the run, and does not stop the message
 *     either.** A bad address in the third row must not cancel the
 *     ninety-day check-in for everyone after it, and a delivery that fails
 *     once (an SMTP hiccup, a full inbox) is retried on the next run rather
 *     than dropped for good. An enrolment is only ever marked `done` once
 *     every one of its deliveries has actually been sent, never merely
 *     attempted.
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

/**
 * The line that turns a check-in into a collection.
 *
 * Appended only when the case's memory book is actually open, so a home
 * that is not keeping one sends exactly the message it sent before.
 *
 * Written as an invitation with an explicit way out, and phrased so that
 * doing nothing is a complete response. The check-ins earn their welcome by
 * never asking anything of somebody who is not up to it, and a book is not
 * worth spending that on.
 */
function memoryInvitation(name: string, dayOffset: number): string {
  if (dayOffset === 365) {
    return (
      `\n\nWe have been keeping a book of memories of ${name} — the ` +
      `photographs from the service, and whatever anyone has wanted to add. ` +
      `It is yours, and you can print it whenever you like. If there is ` +
      `something you would still like in it, there is room.`
    );
  }

  return (
    `\n\nIf something about ${name} has come back to you lately — the way ` +
    `she answered the telephone, a Christmas, anything at all — you can add ` +
    `it to the book of memories we are keeping alongside the photographs. ` +
    `A sentence is enough, and there is no hurry.`
  );
}

export type AftercareRunResult = {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  mailConfigured: boolean;
};

/**
 * Where a family's reply to a check-in should land: the same inbox the home
 * chose for requests from its public page, or, failing that, the owner's,
 * which is the one address every home is guaranteed to have. The same order
 * the intake alert uses, so a home has one place its families' mail arrives.
 *
 * Remembered per run, because one home can have a dozen check-ins due on the
 * same morning and the answer does not change between them.
 */
const replyToCache = new Map<number, string | null>();

async function replyToFor(
  homeId: number,
  homeInbox: string | null,
): Promise<string | null> {
  const configured = homeInbox?.trim();
  if (configured) return configured;
  if (replyToCache.has(homeId)) return replyToCache.get(homeId)!;

  const [owner] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.funeralHomeId, homeId), eq(usersTable.role, "owner")))
    .limit(1);

  const address = owner?.email ?? null;
  replyToCache.set(homeId, address);
  return address;
}

export async function runAftercare(
  options: { dryRun?: boolean; now?: Date; limit?: number } = {},
): Promise<AftercareRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const mailConfigured = isMailConfigured();
  replyToCache.clear();

  const due = await db
    .select({
      delivery: aftercareDeliveriesTable,
      enrollment: aftercareEnrollmentsTable,
      contactName: familyContactsTable.name,
      contactId: familyContactsTable.id,
      contactExpiresAt: familyContactsTable.expiresAt,
      contactRevokedAt: familyContactsTable.revokedAt,
      firstName: casesTable.decedentFirstName,
      preferredName: casesTable.decedentPreferredName,
      homeId: funeralHomesTable.id,
      homeInbox: funeralHomesTable.intakeNotifyEmail,
      bookClosesAt: memoryBooksTable.closesAt,
      bookId: memoryBooksTable.id,
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
    .innerJoin(funeralHomesTable, eq(funeralHomesTable.id, casesTable.funeralHomeId))
    /*
     * Left, not inner: most cases have no memory book, and a check-in must
     * never fail to go out because of a feature the home is not using.
     */
    .leftJoin(memoryBooksTable, eq(memoryBooksTable.caseId, casesTable.id))
    .where(
      and(
        lte(aftercareDeliveriesTable.dueAt, now),
        isNull(aftercareDeliveriesTable.sentAt),
        // A delivery that failed once is retried on the next run rather than
        // dropped for good — see the "outstanding" check below, which relies
        // on exactly this to keep an enrolment from being marked `done` while
        // one of its check-ins never actually went out.
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

    /*
     * Is there an open book to invite them to?
     *
     * `closesAt` null means open, which is the default. A home that closed
     * the book for printing last week should not be asking for more.
     */
    const bookOpen =
      row.bookId !== null &&
      (row.bookClosesAt === null || row.bookClosesAt > now);

    /*
     * Keep their way in working.
     *
     * A family link lives 90 days from issue and the anniversary check-in
     * lands at 365, so without this the book quietly stops accepting
     * anything from the family some time around the third message — the
     * exact failure that makes a collection feature look like it works
     * right up until the year it was built for.
     *
     * The **same token** is extended rather than a new one issued. Minting
     * a replacement would kill the link in the text message they already
     * have, which is the one they will actually click. And the raw token
     * is never stored -- only its digest -- so this is the only way to keep
     * a working link working, and that property is worth more than a
     * prettier email.
     *
     * Narrow on purpose: only for somebody who consented to a year of
     * contact, only while their book is open, and never for a link a
     * director has revoked. Revocation stays absolute.
     *
     * Done before the check on whether mail can actually go out, and that
     * is deliberate. Whether this deployment has SMTP credentials is our
     * problem, not the family's: they were told at the funeral that they
     * would hear from the home, they have a book open, and their way in
     * should not lapse because of our configuration. A dry run still
     * changes nothing.
     */
    if (!dryRun && bookOpen && row.contactRevokedAt === null) {
      const keepUntil = new Date(now.getTime() + FAMILY_LINK_TTL_MS);

      if (row.contactExpiresAt < keepUntil) {
        await db
          .update(familyContactsTable)
          .set({ expiresAt: keepUntil })
          .where(eq(familyContactsTable.id, row.contactId));
      }
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
        body:
          template.body(deceased) +
          (bookOpen ? memoryInvitation(deceased, row.delivery.dayOffset) : ""),
        brandedAs: row.enrollment.brandedAs,
        replyTo: await replyToFor(row.homeId, row.homeInbox),
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
            // Not `sentAt` alone: a delivery that failed and will be retried
            // on the next run is still outstanding, not done. Marking the
            // enrolment `done` here previously required only `sentAt` to be
            // null-free of a *permanent* failure record, which a delivery
            // that had merely failed once already satisfied.
            isNull(aftercareDeliveriesTable.sentAt),
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
