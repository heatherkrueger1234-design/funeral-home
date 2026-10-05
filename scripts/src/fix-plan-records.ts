/**
 * Put right what plans saved before 5 October left behind.
 *
 *   pnpm --filter @workspace/scripts run fix-plan-records            # report
 *   pnpm --filter @workspace/scripts run fix-plan-records -- --apply # and fix
 *
 * Only a database that held a plan before then needs it, and running it twice
 * changes nothing the second time. It reads first and prints what it would
 * do; only `--apply` writes, in one transaction. The report names cases and
 * homes by number, never a person: it is run against live data, and the
 * output ends up in a terminal's scrollback.
 *
 * Three things, in order, because each needs the one before:
 *
 *  1. The planner, marked as the person the plan is for. `isSubject` did not
 *     exist, so a plan accepted from the public request form has the planner
 *     as an ordinary contact, and a relative reading the same plan is told
 *     "your plan". Marked where the contact is the one the request created
 *     (same case, same name as the request). Plans a director opened by hand
 *     are listed, not guessed at: tick the planner in the console.
 *
 *  2. A planner who has since died. A plan that became at-need before
 *     5 October kept the planner's link live, kept them as next of kin, and
 *     closing the case enrolled them in grief check-ins at their own address.
 *     Their link is closed and any check-ins stopped, exactly as the
 *     conversion now does.
 *
 *  3. The planner named as informant on their own certificate. The plan's
 *     certificate page filled "About you" from the reader's own details until
 *     4 October, and saving wrote it to the record (`informantIsTheSubject`).
 *     Cleared on a plan, or a case that was one. Elsewhere — an at-need file
 *     whose informant shares the name of the person who died, which is
 *     usually a mistake and occasionally a son of the same name — listed for
 *     a person to look at, and left alone.
 */
import { pool } from "@workspace/db";
import { fixPlanRecords, type Change } from "./lib/plan-records";

const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("fix-plan-records: DATABASE_URL is not set.");
  process.exit(1);
}

async function main(): Promise<void> {
  const { changes, review } = await fixPlanRecords({ apply: APPLY });
  const line = (c: Change) => `  home ${c.homeId}, case ${c.caseId}: ${c.what}`;

  console.log(APPLY ? "Changed:" : "Would change (dry run; --apply to write):");
  console.log(changes.length ? changes.map(line).join("\n") : "  nothing");
  console.log("");
  console.log("For a person to look at (never changed by this script):");
  console.log(review.length ? review.map(line).join("\n") : "  nothing");
}

main()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error("fix-plan-records:", error instanceof Error ? error.message : error);
    await pool.end();
    process.exit(1);
  });
