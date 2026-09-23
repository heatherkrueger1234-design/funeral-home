/**
 * Restore a pg_dump taken by `backup-database`.
 *
 *   pnpm --filter @workspace/scripts run restore-database -- --file ./backups/x.sql.enc
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
 *
 * `--file` ending in `.sql.enc` (what `backup-database` now writes) is
 * decrypted to a temporary plaintext file first, which is removed again once
 * this script exits, restore or not. Decryption verifies the whole file
 * authenticates before any of it is written to disk — a truncated or
 * tampered backup fails here, not partway through a psql run against a live
 * database. A bare `.sql` file (from before backups were encrypted) still
 * works unchanged.
 */
import { spawn } from "node:child_process";
import { stat, readFile, rm } from "node:fs/promises";
import { decryptFile, isEncryptedBackupName } from "./backup-crypto";

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
        "--set",
        "ON_ERROR_STOP=1",
        "--file",
        target,
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

  const encrypted = isEncryptedBackupName(file!);
  const dumpFile = encrypted ? `${file}.restore-${process.pid}.tmp` : file!;

  try {
    if (encrypted) {
      console.log("Decrypting…");
      await decryptFile(file!, dumpFile);
    }

    const dumpInfo = encrypted ? await stat(dumpFile) : info;

    // Read the head rather than trusting the extension: restoring a
    // truncated or wrong file over a live database is the worst outcome
    // available here.
    const head = (await readFile(dumpFile)).subarray(0, 4096).toString("utf8");

    if (!head.includes("PostgreSQL database dump")) {
      throw new Error(
        `${file} does not look like a pg_dump. Refusing to run it.`,
      );
    }

    console.log(
      `Dump:   ${file} (${(dumpInfo.size / 1024 / 1024).toFixed(1)} MB` +
        `${encrypted ? ", decrypted" : ""})`,
    );
    console.log(`Target: ${describeTarget(DATABASE_URL!)}`);

    if (!confirmed) {
      console.error(
        "\nThis will DROP and replace everything in that database.\n" +
          "Check the target above is the one you mean, then add --yes.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("\nRestoring…");
    await psql(dumpFile);
    console.log(
      "Done. Check a few rows before telling anyone it worked — a restore that " +
        "ran without errors is not the same as a restore that is complete.",
    );
  } finally {
    // The decrypted plaintext is temporary regardless of how this exits —
    // a successful restore, a bad dump, or the user declining to confirm.
    if (encrypted) await rm(dumpFile, { force: true }).catch(() => {});
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
