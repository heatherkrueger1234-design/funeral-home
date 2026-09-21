/**
 * Send the grief check-ins that are due, from the command line.
 *
 *   pnpm --filter @workspace/scripts run send-aftercare -- --dry-run
 *
 * The work itself lives in `@workspace/mailer/aftercare`, so this and the
 * scheduled endpoint in the API server do exactly the same thing. In normal
 * operation the scheduler calls the endpoint; this exists for the times
 * somebody needs to run it by hand and watch what happens.
 */

import { pool } from "@workspace/db";
import { runAftercare } from "@workspace/mailer/aftercare";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const result = await runAftercare({ dryRun });

  if (result.due === 0) {
    console.log("Nothing due.");
    return;
  }

  if (!result.mailConfigured && !dryRun) {
    console.warn(
      "SMTP is not configured, so nothing was sent. " +
        `${result.due} check-in(s) are waiting.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${result.due} due${dryRun ? " (dry run)" : ""} — ` +
      `sent ${result.sent}, failed ${result.failed}, skipped ${result.skipped}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
