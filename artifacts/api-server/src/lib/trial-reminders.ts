import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  usersTable,
  TRIAL_REMINDERS,
  trialReminderSent,
  type TrialReminderKey,
} from "@workspace/db";
import { sendTrialReminderEmail } from "@workspace/mailer";
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
  dryRun: boolean;
  mailConfigured: boolean;
};

/** Days between now and the end of the trial, rounded up, floored at zero. */
function daysUntil(endsAt: Date, now: Date): number {
  const ms = endsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
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
): TrialReminderKey | null {
  const reached = TRIAL_REMINDERS.filter(
    (reminder) =>
      daysLeft <= reminder.daysBefore && !trialReminderSent(home, reminder.key),
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
   * receive a message about their trial ending. Internal accounts are
   * excluded because emailing ourselves about our own trial is noise, and
   * suspended homes because a reminder to subscribe is not the conversation
   * that needs having with a home somebody switched off on purpose.
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
        isNotNull(funeralHomesTable.trialEndsAt),
        eq(funeralHomesTable.internalAccount, false),
        isNull(funeralHomesTable.suspendedAt),
      ),
    )
    .limit(options.limit ?? 500);

  let due = 0;
  let sent = 0;
  let skipped = 0;

  const base = process.env["CONSOLE_URL"]?.replace(/\/+$/, "") ?? "";

  for (const { home, ownerEmail } of candidates) {
    const daysLeft = daysUntil(home.trialEndsAt!, now);
    const key = reminderDue(home, daysLeft);

    if (!key) continue;

    due += 1;

    if (dryRun) continue;

    if (!(await claim(home.id, key))) {
      // Another run took it between the read and the claim.
      skipped += 1;
      continue;
    }

    await sendTrialReminderEmail({
      to: ownerEmail,
      homeName: home.name,
      daysLeft,
      billingUrl: `${base}/settings?billing=1`,
    });

    sent += 1;

    logger.info(
      { funeralHomeId: home.id, reminder: key, daysLeft },
      "Trial reminder sent",
    );
  }

  return { due, sent, skipped, dryRun, mailConfigured };
}
