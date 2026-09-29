import {
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
  casesTable,
  db,
  funeralHomesTable,
  homeLicensureTable,
  licensureReminders,
  practitionerLicencesTable,
  usersTable,
  type PractitionerLicence,
} from "@workspace/db";
import { isMailConfigured } from "@workspace/mailer";
import { and, asc, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { isSmsConfigured } from "../../lib/sms";
import {
  actor,
  customerHomes,
  platformEngagementFor,
  recordPlatformAccess,
  toAdminHome,
} from "./shared";

/** The overview: who to ring this week. */
const router: IRouter = Router();

/* ------------------------------------------------------------ overview -- */

/**
 * The first screen. Answers, in order, the three questions Heather actually
 * has: how many customers are there, which of them is about to have a
 * problem with DORA, and is anybody stuck.
 */
router.get("/admin/overview", async (req, res) => {
  const who = actor(req);

  const [totals] = await db
    .select({
      homes: count(),
      suspended:
        sql<number>`count(*) filter (where ${funeralHomesTable.suspendedAt} is not null)`.mapWith(
          Number,
        ),
      paying:
        sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'active')`.mapWith(
          Number,
        ),
      onTrial:
        sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'trial')`.mapWith(
          Number,
        ),
      // The two that are money going wrong. Without them the four figures
      // above did not add up to the total, and the difference was exactly
      // the homes somebody should be ringing.
      pastDue:
        sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'past_due')`.mapWith(
          Number,
        ),
      canceled:
        sql<number>`count(*) filter (where ${funeralHomesTable.subscriptionStatus} = 'canceled')`.mapWith(
          Number,
        ),
    })
    .from(funeralHomesTable)
    .where(customerHomes);

  // Every home that has any licensure record at all, with its people. Small
  // by construction — this is a list of customers, not of cases.
  const homes = await db
    .select()
    .from(funeralHomesTable)
    .where(customerHomes)
    .orderBy(asc(funeralHomesTable.name));

  const licensure = await db.select().from(homeLicensureTable);
  const practitioners = await db.select().from(practitionerLicencesTable);

  const licensureByHome = new Map(
    licensure.map((row) => [row.funeralHomeId, row]),
  );
  const practitionersByHome = new Map<number, PractitionerLicence[]>();
  for (const row of practitioners) {
    const list = practitionersByHome.get(row.funeralHomeId) ?? [];
    list.push(row);
    practitionersByHome.set(row.funeralHomeId, list);
  }

  const attention = homes
    .map((home) => ({
      home: toAdminHome(home),
      reminders: licensureReminders(
        licensureByHome.get(home.id) ?? null,
        practitionersByHome.get(home.id) ?? [],
      ).filter((reminder) => reminder.standing !== "ahead"),
    }))
    .filter((entry) => entry.reminders.length > 0);

  const engagement = await platformEngagementFor(homes.map((home) => home.id));

  const platformTotals = {
    casesOpened: 0,
    familyLinksCreated: 0,
    familyLinksOpened: 0,
    photographs: 0,
    aftercareEnrolled: 0,
    aftercareConsented: 0,
  };

  for (const entry of engagement.values()) {
    platformTotals.casesOpened += entry.casesOpened;
    platformTotals.familyLinksCreated += entry.familyLinksCreated;
    platformTotals.familyLinksOpened += entry.familyLinksOpened;
    platformTotals.photographs += entry.photographs;
    platformTotals.aftercareEnrolled += entry.aftercareEnrolled;
    platformTotals.aftercareConsented += entry.aftercareConsented;
  }

  await recordPlatformAccess(
    who,
    "platform.overview",
    null,
    `${homes.length} homes`,
  );

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  /*
   * Trials about to end, and trials that ended without a subscription.
   *
   * The conversation a founder most wants to have on time: a home whose trial
   * finishes next Tuesday is a phone call this week, and one whose trial ended
   * a fortnight ago and never subscribed is a home that has stopped opening
   * cases without anybody noticing. Suspended homes are left out -- somebody
   * already made a decision about them.
   */
  const TRIAL_HORIZON_DAYS = 14;
  const trials = homes
    .filter(
      (home) =>
        home.subscriptionStatus === "trial" &&
        home.suspendedAt === null &&
        home.trialEndsAt !== null &&
        home.trialEndsAt.getTime() - now <= TRIAL_HORIZON_DAYS * DAY_MS &&
        now - home.trialEndsAt.getTime() <= 30 * DAY_MS,
    )
    .sort((a, b) => a.trialEndsAt!.getTime() - b.trialEndsAt!.getTime())
    .map((home) => ({
      home: toAdminHome(home),
      trialEndsAt: home.trialEndsAt!,
    }));

  /*
   * Homes that have gone quiet.
   *
   * Facts, not a score. The comment on `platformEngagementFor` explains why
   * this file must not invent a definition of "engaged"; what it can do is
   * state the three plain things that, in practice, come before a home
   * cancels -- nobody ever finished signing in, no case for a month, or links
   * sent that no family has opened -- and let a person decide whether to
   * ring. Each is a sentence the screen shows as it stands.
   */
  const QUIET_AFTER_DAYS = 30;
  const homeIds = homes.map((home) => home.id);

  const lastCases = homeIds.length
    ? await db
        .select({
          homeId: casesTable.funeralHomeId,
          latest: sql<string>`max(${casesTable.createdAt})`,
        })
        .from(casesTable)
        .where(inArray(casesTable.funeralHomeId, homeIds))
        .groupBy(casesTable.funeralHomeId)
    : [];
  const lastCaseAt = new Map(
    lastCases.map((row) => [row.homeId, new Date(row.latest)]),
  );

  // Whether anybody at the home can actually sign in. A derived boolean,
  // as on the home's own page -- no hash is ever selected here.
  const signedUp = homeIds.length
    ? await db
        .select({ homeId: usersTable.funeralHomeId })
        .from(usersTable)
        .where(
          and(
            inArray(usersTable.funeralHomeId, homeIds),
            isNull(usersTable.deactivatedAt),
            sql`${usersTable.passwordHash} is not null`,
          ),
        )
        .groupBy(usersTable.funeralHomeId)
    : [];
  const canSignIn = new Set(signedUp.map((row) => row.homeId));

  const quiet = homes
    .filter((home) => home.suspendedAt === null)
    .flatMap((home) => {
      const age = now - home.createdAt.getTime();
      const latest = lastCaseAt.get(home.id) ?? null;
      const counts = engagement.get(home.id);

      let reason: string | null = null;
      // Only said when it is the point: "the last was 3 August" beside
      // "links sent, none opened" would be answering a different question.
      let since: Date | null = null;
      if (!canSignIn.has(home.id)) {
        // A few days' grace: an invitation sent this morning is not news.
        if (age >= 3 * DAY_MS) {
          reason = "Nobody has finished setting up a sign-in yet.";
        }
      } else if (latest === null) {
        if (age >= QUIET_AFTER_DAYS * DAY_MS) {
          reason = "No case opened since they joined.";
        }
      } else if (now - latest.getTime() >= QUIET_AFTER_DAYS * DAY_MS) {
        reason = "No case opened in the last thirty days.";
        since = latest;
      } else if (
        counts &&
        counts.familyLinksCreated > 0 &&
        counts.familyLinksOpened === 0
      ) {
        reason = "Family links sent, and none opened yet.";
      }

      return reason
        ? [{ home: toAdminHome(home), reason, lastCaseAt: since }]
        : [];
    });

  /*
   * Is mail actually leaving the building?
   *
   * Every promise this product makes after the funeral is an email -- the
   * aftercare check-ins, the trial reminders, a director's password reset --
   * and before this the platform had no way to see that they were failing
   * short of reading the server log. `/healthz` says whether SMTP is
   * configured; it cannot say that the provider has been refusing everything
   * since Tuesday. The aftercare sender already writes `failedAt` against the
   * delivery it could not send, so this is a count of those, across every
   * customer, over the last month -- a number, not whose check-in it was.
   */
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [failures] = await db
    .select({
      failed: count(),
      homes:
        sql<number>`count(distinct ${aftercareEnrollmentsTable.funeralHomeId})`.mapWith(
          Number,
        ),
      // Mapped through the column, not left as `sql<string>`. `failed_at` is
      // a timestamp without a zone, so the raw aggregate came back as
      // "2026-09-14 16:02:11.5" -- which a browser reads as *local* time and
      // renders hours out -- while every other date in this API is an ISO
      // string in UTC. The column's own mapping is what makes those agree.
      latest:
        sql<Date | null>`max(${aftercareDeliveriesTable.failedAt})`.mapWith(
          aftercareDeliveriesTable.failedAt,
        ),
    })
    .from(aftercareDeliveriesTable)
    .innerJoin(
      aftercareEnrollmentsTable,
      eq(aftercareEnrollmentsTable.id, aftercareDeliveriesTable.enrollmentId),
    )
    .innerJoin(
      funeralHomesTable,
      eq(funeralHomesTable.id, aftercareEnrollmentsTable.funeralHomeId),
    )
    .where(
      and(
        customerHomes,
        isNull(aftercareDeliveriesTable.sentAt),
        gte(aftercareDeliveriesTable.failedAt, since),
      ),
    );

  /*
   * Trials that end this week, soonest first.
   *
   * The one billing question that has a deadline attached: a home whose
   * trial runs out stops being able to open cases, and the time to ring them
   * is before a director finds that out with a family sitting across the
   * desk. Suspended homes are left out -- they cannot open cases already, and
   * somebody decided that on purpose.
   */
  const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
  const trialsEndingSoon = homes
    .filter(
      (home) =>
        home.subscriptionStatus === "trial" &&
        home.suspendedAt === null &&
        home.trialEndsAt !== null &&
        home.trialEndsAt.getTime() > now &&
        home.trialEndsAt.getTime() <= weekAhead,
    )
    .sort((a, b) => a.trialEndsAt!.getTime() - b.trialEndsAt!.getTime())
    .map(toAdminHome);

  res.json({
    homes: totals,
    engagement: platformTotals,
    attention,
    trialsEndingSoon,
    trials,
    quiet,
    delivery: {
      mailConfigured: isMailConfigured(),
      smsConfigured: isSmsConfigured(),
      aftercareFailedLast30Days: failures?.failed ?? 0,
      homesWithFailures: failures?.homes ?? 0,
      lastFailureAt: failures?.latest ?? null,
    },
  });
});

export default router;
