import { and, asc, eq, isNull, lte } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  casesTable,
  familyContactsTable,
  funeralHomesTable,
  memoryBooksTable,
  usersTable,
  AFTERCARE_COPY_KEYS,
  AFTERCARE_TOUCHPOINTS,
  FAMILY_LINK_TTL_MS,
  aftercareGraceMs,
  isAftercareHour,
  type AftercareCopyKey,
} from "@workspace/db";
import { signId } from "@workspace/db/crypto";
import { sendAftercareEmail, isMailConfigured } from "./index";
import { isSmsConfigured, normalisePhone, sendSms } from "./sms";

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

/**
 * The default wording, keyed as `AFTERCARE_COPY_KEYS`. `{name}` is the
 * person who died. A home can replace any of these in Settings; what it
 * writes is sent as written.
 */
export const AFTERCARE_DEFAULT_COPY: Record<AftercareCopyKey, { subject: string; body: string }> = {
  "30": {
    subject: "Thinking of you",
    body:
      "It has been a month since {name}'s service.\n\n" +
      "This is often the point when the cards stop arriving and everyone else " +
      "goes back to their week, which can make it a harder month rather than an " +
      "easier one. If today is a bad day, that is not a sign anything is going " +
      "wrong.\n\n" +
      "There is nothing you need to do with this message.",
  },
  "60": {
    subject: "Two months on",
    body:
      "Two months since {name}'s service.\n\n" +
      "Grief is not a line that goes steadily down. A good fortnight followed " +
      "by a week where you cannot function is the ordinary shape of it, not a " +
      "setback.\n\n" +
      "If you would like to talk to someone, we can point you to people locally.",
  },
  "90": {
    subject: "Three months on",
    body:
      "Three months since {name}'s service.\n\n" +
      "Some people find this is when the practical work finally stops and the " +
      "loss itself gets louder. If that is where you are, you are not behind.\n\n" +
      "We are still here, and you are welcome to call.",
  },
  "365": {
    subject: "A year today",
    body:
      "A year today since {name}'s service.\n\n" +
      "Anniversaries are often heavier than the day itself, partly because most " +
      "people no longer know the date. We do.\n\n" +
      "Thinking of you and your family today.",
  },
  birthday: {
    subject: "Thinking of you today",
    body:
      "Today would have been {name}'s birthday.\n\n" +
      "The first birthday is one of the days people warn you least about. " +
      "However you spend it — marking it, or getting through it — is the right way.\n\n" +
      "There is nothing you need to do with this message.",
  },
  holidays: {
    subject: "Before the holidays",
    body:
      "The first holiday season without {name} is close.\n\n" +
      "Many families find it helps to decide ahead of time what to keep and what " +
      "to let go of this year, and to say so out loud. There is no right way to do it.\n\n" +
      "We are thinking of you.",
  },
  death_anniversary: {
    subject: "Remembering {name}",
    body:
      "It has been a year since {name} died.\n\n" +
      "We have not forgotten, and we did not want today to pass without saying so.\n\n" +
      "Thinking of you and your family.",
  },
};

/** The home's wording for a note if it wrote one, else the default. */
export function aftercareMessage(
  key: AftercareCopyKey,
  copy: Record<string, { subject: string; body: string }> | null | undefined,
  name: string,
): { subject: string; body: string } {
  const own = copy?.[key];
  const chosen =
    own && own.subject?.trim() && own.body?.trim() ? own : AFTERCARE_DEFAULT_COPY[key];
  const fill = (text: string) => text.replace(/\{name\}/g, name);
  return { subject: fill(chosen.subject), body: fill(chosen.body) };
}

/** Which copy key a delivery row uses. */
export function copyKeyFor(kind: string, dayOffset: number): AftercareCopyKey | null {
  if (kind === "checkin") {
    const key = String(dayOffset);
    return (AFTERCARE_COPY_KEYS as readonly string[]).includes(key) &&
      !(AFTERCARE_TOUCHPOINTS as readonly string[]).includes(key)
      ? (key as AftercareCopyKey)
      : null;
  }
  return (AFTERCARE_TOUCHPOINTS as readonly string[]).includes(kind)
    ? (kind as AftercareCopyKey)
    : null;
}

/**
 * The text version: the note's first paragraph, signed, with the opt-out
 * carriers require. Short enough for two segments at most.
 */
export function aftercareSmsBody(brandedAs: string, body: string, emailToo: boolean): string {
  const first = body.split("\n\n")[0]!.trim();
  return (
    `${brandedAs}: ${first}` +
    (emailToo ? " We've sent a longer note by email." : " Thinking of you.") +
    " Reply STOP to opt out."
  );
}

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
    // "They", not "she": this goes to every family whose book is open, and
    // it used to tell a widow that her husband answered the telephone the
    // way *she* did — in the one message that is meant to show somebody at
    // the funeral home remembers him.
    `\n\nIf something about ${name} has come back to you lately — the way ` +
    `they answered the telephone, a Christmas, anything at all — you can add ` +
    `it to the book of memories we are keeping alongside the photographs. ` +
    `A sentence is enough, and there is no hurry.`
  );
}

/**
 * The way out, printed at the foot of every check-in.
 *
 * Consent was asked for once, in the portal, with a decline of equal weight
 * — but the portal link lives ninety days and the anniversary note lands at
 * a year, so "you can stop them at any time" was only true for as long as
 * the family could still find the text message. CAN-SPAM wants a working
 * unsubscribe in the message itself (COLORADO.md, section 6), and so does
 * anybody who opens a grief note on a day they cannot face one.
 *
 * The token is the enrolment id signed under a key derived from
 * ENCRYPTION_KEY, so it never expires and cannot be forged for anybody
 * else's enrolment (see `signId`). It is a query parameter rather than a
 * path segment because the request logger drops query strings.
 *
 * Null when the deployment has not said where the portal is; the email then
 * says to reply instead, which reaches the home — see `sendAftercareEmail`.
 */
export const AFTERCARE_UNSUBSCRIBE_PURPOSE = "aftercare-unsubscribe";

export function aftercareUnsubscribeUrl(enrollmentId: number): string | null {
  const base = process.env["FAMILY_PORTAL_URL"]?.replace(/\/+$/, "");
  if (!base) return null;

  const token = signId(AFTERCARE_UNSUBSCRIBE_PURPOSE, enrollmentId);
  return `${base}/stop?token=${encodeURIComponent(token)}`;
}

/** One-click unsubscribe (RFC 8058) for mail clients that offer it. */
export function aftercareOneClickUrl(enrollmentId: number): string | null {
  const base = process.env["FAMILY_PORTAL_URL"]?.replace(/\/+$/, "");
  if (!base) return null;

  const token = signId(AFTERCARE_UNSUBSCRIBE_PURPOSE, enrollmentId);
  return `${base}/api/public/aftercare/unsubscribe?token=${encodeURIComponent(token)}`;
}

function postalAddressOf(row: {
  homeAddressLine1: string | null;
  homeAddressLine2: string | null;
  homeCity: string | null;
  homeRegion: string | null;
  homePostalCode: string | null;
}): string | null {
  const town = [row.homeCity, [row.homeRegion, row.homePostalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const parts = [row.homeAddressLine1, row.homeAddressLine2, town]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export type AftercareRunResult = {
  due: number;
  sent: number;
  /** Of `sent`, how many also (or only) went by text. */
  texted: number;
  failed: number;
  skipped: number;
  /**
   * Too late to be true, and so never sent (`aftercareGraceMs`). Not a
   * failure of this run, but a number an operator wants to see: it is what an
   * outage cost families.
   */
  missed: number;
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
      contactOptedOutAt: familyContactsTable.smsOptedOutAt,
      firstName: casesTable.decedentFirstName,
      preferredName: casesTable.decedentPreferredName,
      homeId: funeralHomesTable.id,
      homeInbox: funeralHomesTable.intakeNotifyEmail,
      homeAddressLine1: funeralHomesTable.addressLine1,
      homeAddressLine2: funeralHomesTable.addressLine2,
      homeCity: funeralHomesTable.city,
      homeRegion: funeralHomesTable.region,
      homePostalCode: funeralHomesTable.postalCode,
      home: {
        id: funeralHomesTable.id,
        smsSubaccountSid: funeralHomesTable.smsSubaccountSid,
        smsMessagingServiceSid: funeralHomesTable.smsMessagingServiceSid,
        smsBrandStatus: funeralHomesTable.smsBrandStatus,
        smsCampaignStatus: funeralHomesTable.smsCampaignStatus,
        smsTollFreeNumber: funeralHomesTable.smsTollFreeNumber,
        smsTollFreeStatus: funeralHomesTable.smsTollFreeStatus,
      },
      homeCopy: funeralHomesTable.aftercareCopy,
      homeTouchpoints: funeralHomesTable.aftercareTouchpoints,
      homeTimezone: funeralHomesTable.timezone,
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
    /*
     * Left, not inner: most cases have no memory book, and a check-in must
     * never fail to go out because of a feature the home is not using.
     */
    .leftJoin(memoryBooksTable, eq(memoryBooksTable.caseId, casesTable.id))
    // Inner is right here, unlike the book above: every case has a home, and a
    // check-in with no home to reply to is one nobody should be sending.
    .innerJoin(funeralHomesTable, eq(funeralHomesTable.id, casesTable.funeralHomeId))
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
    .orderBy(asc(aftercareDeliveriesTable.dueAt))
    // Read with room to spare, because some of it is for homes where it is
    // the middle of the night and waits for the next run (below).
    .limit((options.limit ?? 200) * 5)
    .then((rows) =>
      rows
        /*
         * Only between nine and seven, where the home is (`isAftercareHour`).
         * The sender runs every hour, so whatever falls due overnight goes
         * out the next morning, and nothing lands at six o'clock in Oregon.
         * Checked here rather than in SQL so one home with a time zone the
         * database does not know cannot fail every family's check-in.
         */
        .filter((row) => isAftercareHour(now, row.homeTimezone))
        // Bounded, so one very overdue backlog cannot turn a scheduled run
        // into an hour-long request that the scheduler kills half-way.
        .slice(0, options.limit ?? 200),
    );

  const result: AftercareRunResult = {
    due: due.length,
    sent: 0,
    texted: 0,
    failed: 0,
    skipped: 0,
    missed: 0,
    dryRun,
    mailConfigured,
  };

  if (due.length === 0) return result;

  const smsConfigured = isSmsConfigured();

  for (const row of due) {
    const key = copyKeyFor(row.delivery.kind, row.delivery.dayOffset);
    const deceased = row.preferredName?.trim() || row.firstName;
    const to = row.enrollment.email;

    /*
     * Consent, again, at the moment of sending. A touchpoint needs the
     * family's opt-in and the home still offering it; a text needs the
     * family's yes to texts and no STOP since (the STOP list itself is
     * checked inside `sendSms`).
     */
    const isTouchpoint = row.delivery.kind !== "checkin";
    const touchpointAllowed =
      !isTouchpoint ||
      (row.enrollment.touchpointsConsentAt !== null &&
        row.homeTouchpoints.split(",").includes(row.delivery.kind));
    const smsPhone = row.enrollment.phone ? normalisePhone(row.enrollment.phone) : null;
    const wantsSms =
      row.enrollment.smsConsentAt !== null && row.contactOptedOutAt === null && smsPhone !== null;

    if (!touchpointAllowed) {
      // Dealt with, not failed: nobody should chase a note that must not go.
      if (!dryRun) {
        await db
          .update(aftercareDeliveriesTable)
          .set({ sentAt: now, sentVia: "withdrawn" })
          .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      }
      result.skipped += 1;
      continue;
    }

    if (!key || (!to && !wantsSms)) {
      if (!dryRun) {
        await db
          .update(aftercareDeliveriesTable)
          .set({
            failedAt: now,
            failureReason: key
              ? "No email address or agreed mobile number"
              : "No message for this offset",
          })
          .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      }
      result.failed += 1;
      continue;
    }
    const template = aftercareMessage(key, row.homeCopy, deceased);

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

    /*
     * Too late to be true, so it is marked missed rather than sent; see
     * `aftercareGraceMs` for the burst this stops. Checked before whether
     * anything can be sent at all, so a note that fell due while there was
     * no way to send it does not go out weeks later, the day there is. After
     * the link is kept alive above, because the family's way in should not
     * lapse because our sender did.
     */
    if (now.getTime() - row.delivery.dueAt.getTime() > aftercareGraceMs(row.delivery.kind, row.delivery.dayOffset)) {
      if (!dryRun) {
        await db
          .update(aftercareDeliveriesTable)
          .set({ sentAt: now, sentVia: "missed" })
          .where(
            and(
              eq(aftercareDeliveriesTable.id, row.delivery.id),
              isNull(aftercareDeliveriesTable.sentAt),
            ),
          );
      }
      result.missed += 1;
      continue;
    }

    const canEmail = Boolean(to) && mailConfigured;
    const canSms = wantsSms && smsConfigured;
    if (dryRun || (!canEmail && !canSms)) {
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

    const via: string[] = [];
    const problems: string[] = [];

    if (canEmail) {
      try {
        await sendAftercareEmail({
          to: to!,
          subject: template.subject,
          body:
            template.body +
            (bookOpen ? memoryInvitation(deceased, row.delivery.dayOffset) : ""),
          brandedAs: row.enrollment.brandedAs,
          replyTo: await replyToFor(row.homeId, row.homeInbox),
          unsubscribeUrl: aftercareUnsubscribeUrl(row.enrollment.id),
          oneClickUnsubscribeUrl: aftercareOneClickUrl(row.enrollment.id),
          postalAddress: postalAddressOf(row),
        });
        via.push("email");
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "Unknown error");
      }
    }

    if (canSms) {
      try {
        await sendSms({
          to: smsPhone!,
          body: aftercareSmsBody(row.enrollment.brandedAs, template.body, via.includes("email")),
          home: row.home,
        });
        via.push("sms");
        result.texted += 1;
      } catch (error) {
        problems.push(error instanceof Error ? error.message : "Unknown error");
      }
    }

    if (via.length > 0) {
      await db
        .update(aftercareDeliveriesTable)
        .set({ sentVia: via.join(","), failureReason: problems[0] ?? null })
        .where(eq(aftercareDeliveriesTable.id, row.delivery.id));
      result.sent += 1;
    } else {
      await db
        .update(aftercareDeliveriesTable)
        .set({
          sentAt: null,
          failedAt: new Date(),
          failureReason: problems.join("; ") || "Unknown error",
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
