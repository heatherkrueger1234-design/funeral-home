/**
 * Prove a backup restores, by actually restoring it.
 *
 *   pnpm --filter @workspace/scripts run verify-backup -- --file ./backups/x.sql
 *
 * An untested backup is a belief, not a backup, and the belief is only
 * corrected on the day it matters. So this takes the newest dump, restores it
 * into a scratch database nobody is using, counts what came back, and
 * compares that against the live database.
 *
 * Runs read-only against production: it connects to `DATABASE_URL` only to
 * count rows, and every write goes to `VERIFY_DATABASE_URL`. Those must be
 * different, and it refuses to start if they are not — restoring over the
 * database you are verifying is a way to lose everything while checking that
 * you cannot.
 */
import { spawn } from "node:child_process";
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

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

/** The tables whose row counts are worth comparing. */
const TABLES = [
  "funeral_homes",
  "users",
  "cases",
  "family_contacts",
  "case_photos",
  "uploads",
  "obituary_drafts",
  "case_messages",
  "case_deadlines",
  "case_belongings",
  "vital_statistics",
  "aftercare_enrollments",
  "vendors",
] as const;

/**
 * Fingerprint the bytes that cannot be re-created.
 *
 * Row counts are necessary and nowhere near sufficient. The two columns this
 * product could not survive losing are `uploads.data` -- the encrypted
 * photographs, of which this database holds the only copy some families have
 * -- and `vital_statistics.social_security_number`, which is ciphertext under
 * ENCRYPTION_KEY. Both are the kind of value a dump can mangle while keeping
 * every count identical: a bytea escaped one way and restored another, or a
 * client/server version pair that disagrees about encoding, produces exactly
 * this. Counting the rows would call that a clean backup.
 *
 * So take an md5 of the concatenated bytes on both sides and compare. An
 * md5 is not a security claim here; it is a cheap way to notice that a
 * photograph came back different from how it went in.
 *
 * Deliberately computed in the database rather than pulled into this process:
 * the point is to compare what Postgres actually holds, and streaming a
 * gigabyte of photographs through node to hash it would make the drill
 * expensive enough that somebody switches it off.
 */
const DIGESTS = [
  {
    label: "encrypted photographs (uploads.data)",
    // Ordered, so the digest does not depend on Postgres's row order.
    sql: "select md5(coalesce(string_agg(md5(data), ',' order by id), '')) as digest from uploads",
  },
  {
    label: "encrypted SSNs (vital_statistics.social_security_number)",
    sql:
      "select md5(coalesce(string_agg(md5(social_security_number), ',' order by id), '')) " +
      "as digest from vital_statistics where social_security_number is not null",
  },
] as const;

async function digests(url: string): Promise<Record<string, string>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const result: Record<string, string> = {};

    for (const { label, sql } of DIGESTS) {
      const { rows } = await client.query<{ digest: string | null }>(sql);
      result[label] = rows[0]?.digest ?? "";
    }

    return result;
  } finally {
    await client.end();
  }
}

async function counts(url: string): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const result: Record<string, number> = {};

    for (const table of TABLES) {
      const { rows } = await client.query<{ count: string }>(
        // Identifiers come from the fixed list above, never from input.
        `select count(*)::text as count from ${table}`,
      );
      result[table] = Number(rows[0]?.count ?? 0);
    }

    return result;
  } finally {
    await client.end();
  }
}

function psql(url: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      ["--quiet", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--file", file, url],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`psql exited with ${code}`)),
    );
  });
}

/** The most recent finished dump. Partials are ignored by the pattern. */
async function newestDump(dir: string): Promise<string> {
  const entries = (await readdir(dir)).filter((name) =>
    /^holding-today-\d.*\.sql$/.test(name),
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

  const file = arg("file") ?? (await newestDump(BACKUP_DIR));
  const info = await stat(file).catch(() => null);

  if (!info || info.size === 0) fail(`${file} is missing or empty.`);

  const head = (await readFile(file)).subarray(0, 4096).toString("utf8");
  if (!head.includes("PostgreSQL database dump")) {
    fail(`${file} does not look like a pg_dump.`);
  }

  console.log(`Verifying ${path.basename(file)} (${(info.size / 1024 / 1024).toFixed(1)} MB)`);

  const live = await counts(DATABASE_URL);
  const liveDigests = await digests(DATABASE_URL);

  console.log("Restoring into the scratch database…");
  await psql(VERIFY_DATABASE_URL, file);

  const restored = await counts(VERIFY_DATABASE_URL);

  let mismatches = 0;
  let total = 0;

  for (const table of TABLES) {
    const before = live[table] ?? 0;
    const after = restored[table] ?? 0;
    total += after;

    if (before !== after) {
      mismatches += 1;
      console.error(`  ${table}: live ${before}, restored ${after}  ← MISMATCH`);
    } else {
      console.log(`  ${table}: ${after}`);
    }
  }

  if (mismatches > 0) {
    fail(
      `${mismatches} table(s) came back with a different number of rows. ` +
        "Treat this backup as broken.",
    );
  }

  /*
   * A dump can restore cleanly and hold nothing. Rows counted equal on an
   * empty database is exactly what a silently-failing backup looks like, so
   * an empty verification is a failure rather than a pass.
   */
  if (total === 0) {
    fail("The restore produced no rows at all. That is not a working backup.");
  }

  /*
   * And now the part row counts cannot tell you: did the bytes survive.
   */
  const restoredDigests = await digests(VERIFY_DATABASE_URL);
  let corrupted = 0;

  for (const { label } of DIGESTS) {
    const before = liveDigests[label] ?? "";
    const after = restoredDigests[label] ?? "";

    if (before !== after) {
      corrupted += 1;
      console.error(`  ${label}: digest ${before || "(none)"} became ${after || "(none)"}  ← CORRUPTED`);
    } else if (before === "") {
      // Nothing of this kind in the database. Say so rather than printing a
      // matching digest of nothing, which reads like a pass.
      console.log(`  ${label}: none present to check`);
    } else {
      console.log(`  ${label}: byte-identical (${before.slice(0, 12)}…)`);
    }
  }

  if (corrupted > 0) {
    fail(
      "The rows all came back and the encrypted bytes did not. This backup " +
        "would restore a database full of photographs that no longer open.",
    );
  }

  console.log(`\nVerified: ${total} rows restored, every table matching, encrypted bytes identical.`);
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
