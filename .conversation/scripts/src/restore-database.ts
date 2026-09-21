/**
 * Restore a pg_dump taken by `backup-database`.
 *
 *   pnpm --filter @workspace/scripts run restore-database -- --file ./backups/x.sql
 *
 * This is the script somebody runs at three in the morning, having just lost
 * a database holding photographs of other people's dead relatives. Everything
 * about it is shaped by that: it says exactly what it is about to destroy, it
 * refuses to do it without `--yes`, and it checks the dump looks like a dump
 * before dropping anything.
 *
 * The failure it most guards against is not a bad restore. It is a confident
 * one — running against the wrong `DATABASE_URL` and wiping production while
 * trying to test a backup.
 */
import { spawn } from "node:child_process";
import { stat, readFile } from "node:fs/promises";

const DATABASE_URL = process.env.DATABASE_URL;

function fail(message: string): never {
  console.error(`restore-database: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const file = arg("file");
const confirmed = process.argv.includes("--yes");

if (!DATABASE_URL) fail("DATABASE_URL is not set.");
if (!file) fail("Which dump? Pass --file ./backups/<name>.sql");

/** Host and database only — never the password, which ends up in logs. */
function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function psql(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    /*
     * `ON_ERROR_STOP=1` is the difference between a restore and a mess.
     * Without it psql reports success having skipped every statement that
     * failed, which leaves a database that looks restored and is missing
     * rows nobody will notice for weeks.
     */
    const child = spawn(
      "psql",
      [
        "--quiet",
        "--no-psqlrc",
        "--set", "ON_ERROR_STOP=1",
        "--file", target,
        DATABASE_URL!,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("psql is not installed or not on PATH.")
          : error,
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited with code ${code}.`));
    });
  });
}

async function main(): Promise<void> {
  const info = await stat(file!).catch(() => null);

  if (!info) fail(`${file} does not exist.`);
  if (info.size === 0) fail(`${file} is empty. That is not a backup.`);

  // Read the head rather than trusting the extension: restoring a truncated
  // or wrong file over a live database is the worst outcome available here.
  const head = (await readFile(file!)).subarray(0, 4096).toString("utf8");

  if (!head.includes("PostgreSQL database dump")) {
    fail(`${file} does not look like a pg_dump. Refusing to run it.`);
  }

  console.log(`Dump:   ${file} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Target: ${describeTarget(DATABASE_URL!)}`);

  if (!confirmed) {
    console.error(
      "\nThis will DROP and replace everything in that database.\n" +
        "Check the target above is the one you mean, then add --yes.",
    );
    process.exit(1);
  }

  console.log("\nRestoring…");
  await psql(file!);
  console.log(
    "Done. Check a few rows before telling anyone it worked — a restore that " +
      "ran without errors is not the same as a restore that is complete.",
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
