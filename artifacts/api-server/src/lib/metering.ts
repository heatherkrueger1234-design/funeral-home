import { and, asc, eq, isNull } from "drizzle-orm";
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
  dryRun: boolean;
  meteringConfigured: boolean;
};

/**
 * Which Stripe customer a home's funerals are billed to.
 *
 * A location inside a group bills to the group, which is the entire point of
 * the group: one invoice for the estate. A home on its own bills to itself.
 */
async function customerForHome(home: {
  stripeCustomerId: string | null;
  groupId: number | null;
}): Promise<string | null> {
  if (home.groupId !== null) {
    const [group] = await db
      .select({ customer: homeGroupsTable.stripeCustomerId })
      .from(homeGroupsTable)
      .where(eq(homeGroupsTable.id, home.groupId))
      .limit(1);

    return group?.customer ?? null;
  }

  return home.stripeCustomerId;
}

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
    .select({
      row: billableCasesTable,
      stripeCustomerId: funeralHomesTable.stripeCustomerId,
      groupId: funeralHomesTable.groupId,
    })
    .from(billableCasesTable)
    .innerJoin(
      funeralHomesTable,
      eq(funeralHomesTable.id, billableCasesTable.funeralHomeId),
    )
    .where(
      and(
        isNull(billableCasesTable.reportedAt),
        isNull(billableCasesTable.waivedReason),
        /*
         * Never invoice ourselves.
         *
         * A platform admin needs a staff account, a staff account needs a
         * `funeral_homes` row, and the funerals opened in it while trying
         * something out are not funerals anybody owes for. Today they would
         * fall through the "no Stripe customer" skip below and cost nothing,
         * which is luck rather than a rule: attach a customer to that tenant
         * once — to test checkout, which is the obvious thing to do with it —
         * and we would start metering our own demo cases onto a real invoice.
         */
        eq(funeralHomesTable.internalAccount, false),
      ),
    )
    // Oldest first, so a backlog drains in the order the funerals happened
    // rather than in whatever order the index felt like.
    .orderBy(asc(billableCasesTable.countedAt))
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
    dryRun,
    meteringConfigured,
  };

  if (due.length === 0) return result;

  if (!meteringConfigured) {
    // Not a failure. A deployment with no metered price is a product that
    // charges a flat subscription, which is a perfectly good way to sell it.
    result.skipped = due.length;
    return result;
  }

  for (const entry of due) {
    const customerId = await customerForHome(entry);

    if (!customerId) {
      // A home with no Stripe customer has never been through checkout, so
      // there is no subscription for this to be a line on. Left unreported
      // rather than marked failed: nothing is wrong, there is just nobody to
      // bill yet.
      result.skipped += 1;
      continue;
    }

    if (dryRun) {
      result.reported += 1;
      continue;
    }

    const outcome = await reportCaseToMeter({
      customerId,
      caseId: entry.row.caseId,
      at: entry.row.countedAt,
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

  return result;
}
