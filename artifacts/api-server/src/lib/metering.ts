import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  billableCasesTable,
  funeralHomesTable,
  homeGroupsTable,
  type Case,
  type FuneralHome,
} from "@workspace/db";
import { isCaseMeteringConfigured, reportCaseToMeter } from "./billing";
import { logger } from "./logger";

/**
 * Counting funerals, so that a home with volume pays for volume.
 *
 * Two halves, deliberately kept apart: `recordBillableCase` writes a row
 * locally when a case opens, and `runCaseMetering` tells Stripe about the
 * rows later, on a schedule. Nothing here is on the path of a director
 * opening a case, and that separation is the whole design -- see the comment
 * on `billableCasesTable` for why.
 */

/**
 * Count a case, once.
 *
 * Called after the case exists, never inside its transaction, and it cannot
 * fail the case. If this throws, a funeral home standing at a kitchen table
 * with a family still gets their case, and we find out we under-billed them
 * by reading the log. The other way round -- a database hiccup in the
 * accounting code refusing to open a file for somebody whose mother died
 * this morning -- is not a trade this product makes.
 *
 * Pre-need files are not counted, on purpose. Somebody writing down what
 * they want at their own funeral is not a funeral served, and a home that
 * was charged for every pre-need enquiry would very sensibly stop recording
 * them in here. They are counted if and when they convert to at-need, which
 * is the day the home actually does the work.
 */
export async function recordBillableCase(
  row: Case,
  home: FuneralHome,
  now = new Date(),
): Promise<void> {
  if (row.kind === "pre_need") return;

  // A live trial is counted and waived rather than skipped, so that the
  // difference between "funerals you handled" and "funerals we billed you
  // for" is a column somebody can read rather than an absence they have to
  // take on trust.
  const onTrial =
    home.subscriptionStatus === "trial" &&
    (home.trialEndsAt === null || home.trialEndsAt > now);

  try {
    await db
      .insert(billableCasesTable)
      .values({
        funeralHomeId: home.id,
        caseId: row.id,
        countedAt: now,
        waivedReason: onTrial ? "trial" : null,
      })
      // Converting a pre-need file that somehow already has a row, or any
      // other second look at the same case, must not count it twice.
      .onConflictDoNothing({ target: billableCasesTable.caseId });
  } catch (error) {
    logger.error(
      { err: error, caseId: row.id, funeralHomeId: home.id },
      "Could not record a billable case. The case is fine; the invoice is short.",
    );
  }
}

export type MeteringRunResult = {
  due: number;
  reported: number;
  duplicates: number;
  failed: number;
  skipped: number;
  /**
   * Owed, with no Stripe customer to bill: a home paying outside Stripe, or
   * one marked active before it went through checkout. Never sent and never
   * a failure, and counted so that a number nobody is invoicing is a number
   * somebody can see.
   */
  awaitingCustomer: number;
  /**
   * Counted more than three days ago and still not in Stripe, with the last
   * attempt failed. One failure among a night's successes never turned the
   * job red, so a home whose Stripe customer had gone was quietly never
   * billed again.
   */
  stuck: number;
  dryRun: boolean;
  meteringConfigured: boolean;
};

const STUCK_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/*
 * Which Stripe customer a funeral is billed to: the group's, for a location
 * in one -- one invoice for the estate is the entire point of a group -- and
 * the home's own otherwise. Worked out in the query rather than row by row,
 * so rows with nobody to bill can be kept out of the page altogether.
 */
const billedTo = sql<string | null>`case
  when ${funeralHomesTable.groupId} is not null then ${homeGroupsTable.stripeCustomerId}
  else ${funeralHomesTable.stripeCustomerId}
end`;

/** Owed and not yet in Stripe, and never ours. */
const owed = and(
  isNull(billableCasesTable.reportedAt),
  isNull(billableCasesTable.waivedReason),
  /*
   * Never invoice ourselves.
   *
   * A platform admin needs a staff account, a staff account needs a
   * `funeral_homes` row, and the funerals opened in it while trying
   * something out are not funerals anybody owes for. Without this they
   * would be left out only for want of a Stripe customer, which is luck
   * rather than a rule: attach a customer to that tenant once -- to test
   * checkout, which is the obvious thing to do with it -- and we would start
   * metering our own demo cases onto a real invoice.
   */
  eq(funeralHomesTable.internalAccount, false),
);

/**
 * Report everything that has not reached Stripe yet.
 *
 * Failed rows are retried, unlike a failed aftercare check-in, and the
 * difference is worth stating because the two jobs look alike. A grief email
 * that failed three months ago must never be quietly sent today; an invoice
 * line that failed to reach Stripe this morning must absolutely be sent this
 * afternoon. The meter event carries an identifier that Stripe deduplicates
 * on, so retrying costs nothing and missing one costs the month.
 */
export async function runCaseMetering(
  options: { dryRun?: boolean; now?: Date; limit?: number } = {},
): Promise<MeteringRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const meteringConfigured = isCaseMeteringConfigured();

  const due = await db
    .select({ row: billableCasesTable, customerId: billedTo })
    .from(billableCasesTable)
    .innerJoin(funeralHomesTable, eq(funeralHomesTable.id, billableCasesTable.funeralHomeId))
    .leftJoin(homeGroupsTable, eq(homeGroupsTable.id, funeralHomesTable.groupId))
    .where(and(owed, sql`${billedTo} is not null`))
    /*
     * New funerals first, then old failures, oldest first within each.
     * Strictly oldest first, rows that fail every night -- a customer
     * deleted in Stripe -- sat at the front of every page, and with a page's
     * worth of them nothing new was reported again.
     */
    .orderBy(sql`${billableCasesTable.failedAt} is not null`, asc(billableCasesTable.countedAt))
    // Bounded for the same reason the aftercare run is: one very overdue
    // backlog must not turn a scheduled request into an hour the scheduler
    // kills half way through.
    .limit(options.limit ?? 500);

  const result: MeteringRunResult = {
    due: due.length,
    reported: 0,
    duplicates: 0,
    failed: 0,
    skipped: 0,
    awaitingCustomer: 0,
    stuck: 0,
    dryRun,
    meteringConfigured,
  };

  if (!meteringConfigured) {
    // Not a failure. A deployment with no metered price is a product that
    // charges a flat subscription, which is a perfectly good way to sell it.
    result.skipped = due.length;
    return result;
  }

  for (const entry of due) {
    if (dryRun) {
      result.reported += 1;
      continue;
    }

    const outcome = await reportCaseToMeter({
      customerId: entry.customerId!,
      caseId: entry.row.caseId,
      /*
       * When it reaches Stripe, not when it was counted. Stripe refuses a
       * meter event stamped more than 35 days ago, and one stamped inside a
       * billing period that has already been invoiced is on no invoice; a
       * funeral counted late on the last night of a period, or held up by an
       * outage, was billed late or not at all. Stamped now it is on the next
       * invoice, and the identifier still stops it being counted twice.
       */
      at: now,
    });

    if (outcome.ok) {
      await db
        .update(billableCasesTable)
        .set({ reportedAt: now, failedAt: null, failureReason: null })
        .where(eq(billableCasesTable.id, entry.row.id));

      if (outcome.duplicate) result.duplicates += 1;
      else result.reported += 1;
      continue;
    }

    await db
      .update(billableCasesTable)
      .set({ failedAt: now, failureReason: outcome.reason.slice(0, 500) })
      .where(eq(billableCasesTable.id, entry.row.id));

    result.failed += 1;
  }

  // After the run, so `stuck` counts what is still stuck once it has tried.
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const [left] = await db
    .select({
      awaitingCustomer: count(sql`case when ${billedTo} is null then 1 end`),
      stuck: count(
        sql`case when ${billedTo} is not null
                  and ${billableCasesTable.failedAt} is not null
                  and ${billableCasesTable.countedAt} < ${stuckBefore.toISOString()}
             then 1 end`,
      ),
    })
    .from(billableCasesTable)
    .innerJoin(funeralHomesTable, eq(funeralHomesTable.id, billableCasesTable.funeralHomeId))
    .leftJoin(homeGroupsTable, eq(homeGroupsTable.id, funeralHomesTable.groupId))
    .where(owed);

  result.awaitingCustomer = left?.awaitingCustomer ?? 0;
  result.stuck = left?.stuck ?? 0;

  return result;
}
