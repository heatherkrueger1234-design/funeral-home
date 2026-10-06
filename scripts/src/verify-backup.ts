/**
 * Prove a backup restores, by actually restoring it.
 *
 *   pnpm --filter @workspace/scripts run verify-backup -- --file ./backups/x.sql.enc
 *
 * An untested backup is a belief, not a backup, and the belief is only
 * corrected on the day it matters. So this takes the newest dump, restores it
 * into a scratch database nobody is using, and checks two things about what
 * came back:
 *
 *   - every table has the rows it had when the dump was taken. backup-database
 *     counted them in the snapshot pg_dump read and left the numbers beside
 *     the backup (lib/backup-counts.ts). A backup from before it did that is
 *     restored and its counts printed, compared with nothing.
 *   - the restored copy's encrypted columns open with ENCRYPTION_KEY: the
 *     oldest and newest uploaded file and social security number
 *     (lib/encrypted-columns.ts).
 *
 * Never against the live database. It connects to `DATABASE_URL` only to make
 * sure `VERIFY_DATABASE_URL` is not the same database, and every write goes
 * to `VERIFY_DATABASE_URL` -- restoring over the database you are verifying is
 * a way to lose everything while checking that you cannot.
 */
import { spawn } from "node:child_process";
import { readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { decryptFile, isEncryptedBackupName } from "./backup-crypto";
import { compareCounts, countRows, readCounts } from "./lib/backup-counts";
import { looksLikePgDump } from "./lib/dump-head";
import { openSealed, sealedSamples } from "./lib/encrypted-columns";
import { onStop } from "./lib/on-stop";

const DATABASE_URL = process.env.DATABASE_URL;
const VERIFY_DATABASE_URL = process.env.VERIFY_DATABASE_URL;
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";

function fail(message: string): never {
  console.error(`verify-backup: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

/**
 * Which database a URL actually reaches, as the server itself reports it.
 *
 * Comparing the two URLs as strings is not enough, and it was the only check
 * this script had: `localhost` and `127.0.0.1`, a `?sslmode=` suffix, a
 * pooler's hostname in front of the same server, or a different user on the
 * same database all spell one database two ways. Each of those passed the
 * string check, restored the dump over the live database, and then reported
 * "every table matching" -- because it was counting the same rows twice.
 *
 * So ask the server. The database's own oid and the postmaster's start time
 * together name one database on one running cluster; two different clusters
 * agreeing on both is not a coincidence worth designing for. Both are readable
 * by any role that can connect, so this needs no extra privilege.
 */
async function fingerprint(url: string): Promise<string> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<{ fingerprint: string }>(
      `select current_database()
          || ':' || (select oid from pg_database where datname = current_database())::text
          || ':' || pg_postmaster_start_time()::text as fingerprint`,
    );
    return rows[0]?.fingerprint ?? "";
  });
}

function psql(url: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      [
        "--quiet",
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--file",
        file,
        url,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited with ${code}`)),
    );
  });
}

/** The most recent finished dump. Partials and counts are ignored by the pattern. */
async function newestDump(dir: string): Promise<string> {
  const entries = (await readdir(dir)).filter((name) =>
    /^holding-today-\d.*\.sql(\.enc)?$/.test(name),
  );

  if (entries.length === 0) fail(`No backups found in ${dir}.`);

  const withTimes = await Promise.all(
    entries.map(async (name) => ({
      name,
      time: (await stat(path.join(dir, name))).mtimeMs,
    })),
  );

  withTimes.sort((a, b) => b.time - a.time);
  return path.join(dir, withTimes[0]!.name);
}

async function main(): Promise<void> {
  if (!DATABASE_URL) fail("DATABASE_URL is not set.");
  if (!VERIFY_DATABASE_URL) {
    fail(
      "VERIFY_DATABASE_URL is not set. Point it at a scratch database — the " +
        "restore destroys whatever is in it.",
    );
  }
  if (DATABASE_URL === VERIFY_DATABASE_URL) {
    fail(
      "VERIFY_DATABASE_URL is the same as DATABASE_URL. Restoring over the " +
        "database you are verifying would destroy it.",
    );
  }

  const [liveId, verifyId] = await Promise.all([
    fingerprint(DATABASE_URL),
    fingerprint(VERIFY_DATABASE_URL),
  ]);

  if (liveId === "" || liveId === verifyId) {
    fail(
      "VERIFY_DATABASE_URL reaches the same database as DATABASE_URL, spelled " +
        "differently. Restoring over the database you are verifying would " +
        "destroy it. Point VERIFY_DATABASE_URL at a scratch database.",
    );
  }

  const file = arg("file") ?? (await newestDump(BACKUP_DIR));
  const info = await stat(file).catch(() => null);

  if (!info || info.size === 0) fail(`${file} is missing or empty.`);

  // Read, and refused if it is not the right file's, before anything is
  // restored on the strength of it.
  const recorded = await readCounts(file, info.size);

  const encrypted = isEncryptedBackupName(file);
  const dumpFile = encrypted ? `${file}.verify-${process.pid}.tmp` : file;
  // The decrypted copy is the whole database in plain SQL: gone however this
  // ends, a signal included (lib/on-stop.ts).
  const settled = encrypted ? onStop([dumpFile]) : () => {};

  try {
    if (encrypted) {
      console.log("Decrypting…");
      await decryptFile(file, dumpFile);
    }

    const dumpInfo = encrypted ? await stat(dumpFile) : info;

    if (!(await looksLikePgDump(dumpFile))) {
      throw new Error(`${file} does not look like a pg_dump.`);
    }

    console.log(
      `Verifying ${path.basename(file)} (${(dumpInfo.size / 1024 / 1024).toFixed(1)} MB` +
        `${encrypted ? ", decrypted" : ""})`,
    );

    console.log("Restoring into the scratch database…");
    await psql(VERIFY_DATABASE_URL, dumpFile);
  } finally {
    if (encrypted) await rm(dumpFile, { force: true }).catch(() => {});
    settled();
  }

  const { restored, sealed } = await withClient(VERIFY_DATABASE_URL, async (client) => ({
    restored: await countRows(client),
    sealed: await sealedSamples(client),
  }));

  let total: number;
  if (recorded) {
    console.log(`Every table against the counts taken with the dump (${recorded.takenAt}):`);
    const comparison = compareCounts(recorded.rows, restored);
    for (const line of comparison.lines) {
      if (line.endsWith("MISMATCH")) console.error(line);
      else console.log(line);
    }
    if (comparison.others.length > 0) {
      console.log(
        `  (not compared, being no part of this backup: ${comparison.others.join(", ")}, ` +
          "already in the scratch database)",
      );
    }
    if (comparison.mismatches > 0) {
      fail(
        `${comparison.mismatches} table(s) came back with a different number of ` +
          "rows from the dump that was taken. Treat this backup as broken.",
      );
    }
    total = comparison.total;
  } else {
    // Nothing to compare with, and no pretending otherwise.
    console.log(
      "No counts were recorded beside this backup (it was taken before " +
        "backup-database kept them), so these are what came back, compared " +
        "with nothing:",
    );
    total = 0;
    for (const [table, count] of Object.entries(restored)) {
      console.log(`  ${table}: ${count}`);
      total += count;
    }
  }

  /*
   * A dump can restore cleanly and hold nothing. Rows counted equal on an
   * empty database is exactly what a silently-failing backup looks like, so
   * an empty verification is a failure rather than a pass.
   */
  if (total === 0) {
    fail("The restore produced no rows at all. That is not a working backup.");
  }

  const opened = openSealed(sealed);
  console.log(
    opened.length > 0
      ? `Decrypted with this ENCRYPTION_KEY: ${opened.join(", ")}.`
      : "Nothing in this backup is encrypted in its columns: no uploads, no social security numbers.",
  );

  console.log(
    recorded
      ? `\nVerified: ${total} rows restored, every table as it was when the dump was taken.`
      : `\nRestored ${total} rows. With no counts recorded, whether that is every row is not something this can say.`,
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
