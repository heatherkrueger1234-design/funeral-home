import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  calendarDayIn,
  funeralHomesTable,
  usersTable,
  TRIAL_REMINDERS,
  trialReminderSent,
  type TrialReminderKey,
} from "@workspace/db";
import { sendTrialReminderEmail } from "@workspace/mailer";
import { consoleUrl } from "./app-urls";
import { logger } from "./logger";

/**
 * Telling a funeral home where it stands with its trial.
 *
 * This is the least glamorous file in the repository and it is the one that
 * decides whether any of the rest gets paid for. Before it existed, the only
 * notice a home ever got was a banner in a console — so a proprietor who set
 * the product up, used it for three real funerals and then did not sign in for
 * three weeks found out the trial had ended by being refused a case on the
 * morning somebody died. That is a lost customer and a bad morning, caused by
 * a missing email.
 *
 * Shaped like `runAftercare` on purpose: triggered over HTTP rather than by an
 * in-process timer, idempotent, bounded, and with a dry run — for the same
 * reasons, which are written out in `routes/tasks.ts`.
 */

export type TrialReminderRunResult = {
  due: number;
  sent: number;
  skipped: number;
  /** Refused by the mail server, and given back to be tried on the next run. */
  failed: number;
  dryRun: boolean;
  mailConfigured: boolean;
};

/*
 * Nothing is due earlier than seven days before the end on the home's own
 * calendar, which is never more than eight days away by the clock; a day
 * over that, for a clock change, and anything further off is not read.
 */
const NOTHING_DUE_BEYOND_MS = 9 * 24 * 60 * 60 * 1000;

/**
 * Whole days to the end of the trial on the home's own calendar: 1 is
 * tomorrow, 0 is today or over.
 *
 * Counted by calendar, not by hours. A trial ends at the minute the home
 * registered, thirty days on, and this runs once a day; rounding the hours
 * left up to days told a home that registered in the afternoon "your trial
 * ends tomorrow" on the morning of the day it ended -- and it was refused a
 * case that afternoon.
 */
function daysUntil(endsAt: Date, now: Date, timeZone: string): number {
  if (endsAt <= now) return 0;
  const end = calendarDayIn(endsAt, timeZone);
  const today = calendarDayIn(now, timeZone);
  return Math.round(
    (Date.UTC(end.year, end.month, end.day) - Date.UTC(today.year, today.month, today.day)) /
      86400000,
  );
}

/**
 * Which reminder, if any, this home is owed.
 *
 * The earliest unsent milestone whose threshold has been reached, rather than
 * the closest one — so a home registered while the job was broken for a
 * fortnight gets the message that is still true ("your trial has ended")
 * rather than a week's notice that expired days ago. And only one per run: a
 * home does not want three emails in a minute because nobody ran this.
 */
function reminderDue(
  home: { trialRemindersSent: string },
  daysLeft: number,
  ended: boolean,
): TrialReminderKey | null {
  const reached = TRIAL_REMINDERS.filter(
    (reminder) =>
      // "Has ended" waits until it has, not merely for its last day.
      (reminder.daysBefore === 0 ? ended : daysLeft <= reminder.daysBefore) &&
      !trialReminderSent(home, reminder.key),
  );

  // TRIAL_REMINDERS runs 7 → 1 → 0, so the last one reached is the most
  // pressing thing still unsaid.
  return reached.at(-1)?.key ?? null;
}

/**
 * Record a reminder as sent.
 *
 * Appended in SQL with a guard, exactly as `markOnboarding` does, so two
 * overlapping runs cannot both decide a reminder is unsent. Returns whether
 * this run is the one that claimed it — the claim happens *before* the email
 * goes out, which trades a crash losing one reminder for its opposite, which
 * is sending a proprietor the same notice twice.
 */
async function claim(
  funeralHomeId: number,
  key: TrialReminderKey,
): Promise<boolean> {
  const claimed = await db
    .update(funeralHomesTable)
    .set({
      trialRemindersSent: sql`
        case
          when ${funeralHomesTable.trialRemindersSent} = '' then ${key}
          else ${funeralHomesTable.trialRemindersSent} || ',' || ${key}
        end
      `,
      updatedAt: new Date(),
    })
    .where(
      sql`${funeralHomesTable.id} = ${funeralHomeId}
          and not (',' || ${funeralHomesTable.trialRemindersSent} || ',')
                  like ${"%," + key + ",%"}`,
    )
    .returning({ id: funeralHomesTable.id });

  return claimed.length > 0;
}

/**
 * Take a claimed reminder back, when it could not be sent.
 *
 * Recorded as sent and never delivered was the one outcome this job exists to
 * prevent: the home hears nothing, and no later run tries again. Given back,
 * the next run sends whichever reminder is true by then.
 */
async function unclaim(funeralHomeId: number, key: TrialReminderKey): Promise<void> {
  await db
    .update(funeralHomesTable)
    .set({
      trialRemindersSent: sql`trim(both ',' from replace(
        ',' || ${funeralHomesTable.trialRemindersSent} || ',', ${"," + key + ","}, ','
      ))`,
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, funeralHomeId));
}

export async function runTrialReminders(
  options: { dryRun?: boolean; now?: Date; limit?: number } = {},
): Promise<TrialReminderRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  const { isMailConfigured } = await import("@workspace/mailer");
  const mailConfigured = isMailConfigured();

  /*
   * Only homes still on trial, and only ones we can write to.
   *
   * `subscriptionStatus = 'trial'` excludes a home that has already
   * subscribed, which is the whole point — nobody who has paid should ever
   * receive a message about their trial ending. Nor should a home that
   * subscribed during its trial: that trial is Stripe's now, with a card
   * behind it, and "set up a subscription before then" would be asking
   * them to do it twice. Stripe's own reminder before a trial it holds
   * ends is switched on in its settings (PRICING.md). Nor a location in a
   * group, whose trial is the group's: its subscribe button refuses, and
   * the contract is a conversation with whoever holds it. Internal accounts
   * are excluded because emailing ourselves about our own trial is noise,
   * and suspended homes because a reminder to subscribe is not the
   * conversation that needs having with a home somebody switched off on
   * purpose.
   *
   * And only homes something could be due to: not yet a week out, and not
   * already told it has ended. Read a page at a time, finished trials used
   * to fill the page every run, for ever, and once there was a page of them
   * nobody new was reminded again.
   */
  const candidates = await db
    .select({
      home: funeralHomesTable,
      ownerEmail: usersTable.email,
    })
    .from(funeralHomesTable)
    .innerJoin(
      usersTable,
      and(
        eq(usersTable.funeralHomeId, funeralHomesTable.id),
        eq(usersTable.role, "owner"),
        isNull(usersTable.deactivatedAt),
      ),
    )
    .where(
      and(
        eq(funeralHomesTable.subscriptionStatus, "trial"),
        isNull(funeralHomesTable.stripeSubscriptionId),
        isNull(funeralHomesTable.groupId),
        isNotNull(funeralHomesTable.trialEndsAt),
        lt(funeralHomesTable.trialEndsAt, new Date(now.getTime() + NOTHING_DUE_BEYOND_MS)),
        sql`not (',' || ${funeralHomesTable.trialRemindersSent} || ',') like ${"%,trial-ended,%"}`,
        eq(funeralHomesTable.internalAccount, false),
        isNull(funeralHomesTable.suspendedAt),
      ),
    )
    // The most pressing first.
    .orderBy(asc(funeralHomesTable.trialEndsAt))
    .limit(options.limit ?? 500);

  let due = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const { home, ownerEmail } of candidates) {
    const ended = home.trialEndsAt! <= now;
    const daysLeft = daysUntil(home.trialEndsAt!, now, home.timezone);
    const key = reminderDue(home, daysLeft, ended);

    if (!key) continue;

    due += 1;

    if (dryRun) continue;

    if (!(await claim(home.id, key))) {
      // Another run took it between the read and the claim.
      skipped += 1;
      continue;
    }

    try {
      await sendTrialReminderEmail({
        to: ownerEmail,
        homeName: home.name,
        daysLeft,
        ended,
        billingUrl: consoleUrl("/settings?billing=1"),
        // With no mail server at all every email here is written to the log
        // instead, and the run says so (`mailConfigured`); with one, a
        // refusal is a reminder not sent.
        rethrow: mailConfigured,
      });
    } catch (error) {
      // One refusal must not stop the run either: every home after it went
      // without.
      await unclaim(home.id, key);
      failed += 1;
      logger.error(
        { funeralHomeId: home.id, reminder: key, err: error instanceof Error ? error.message : String(error) },
        "Trial reminder not sent; it will be tried again on the next run",
      );
      continue;
    }

    sent += 1;

    logger.info(
      { funeralHomeId: home.id, reminder: key, daysLeft },
      "Trial reminder sent",
    );
  }

  return { due, sent, skipped, failed, dryRun, mailConfigured };
}
