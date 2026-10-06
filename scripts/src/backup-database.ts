/**
 * Take a pg_dump of DATABASE_URL, keep it, and throw away the old ones.
 *
 * There is no managed backup behind this database. What is in it is what
 * bereaved parents wrote about their children — the one copy of some of it
 * that exists anywhere. So this script is deliberately loud: it writes to a
 * temporary name and only renames on success, it never overwrites, and it
 * exits non-zero on any failure so a scheduler reports a broken backup
 * instead of quietly keeping none.
 *
 * A backup on the same disk as the database does not survive the failure it
 * exists for, so with BACKUP_OFFSITE set each new dump is also copied off
 * this host with rclone and the copy checked (`sendOffsite`). Without it, the
 * run still succeeds and says plainly that nothing left the machine.
 *
 * Beside each backup goes `<backup>.counts.json`: every table's row count,
 * taken in the snapshot pg_dump reads (`dumpWithCounts`). It is what
 * verify-backup holds a restore to, and it travels with its backup: pruned
 * with it, copied off the host with it.
 *
 * Until the encrypted copy is in place the dump is plaintext, and it never
 * has a finished backup's name: it is written, and encrypted, under
 * `.partial` names, which are removed on any failure, on any signal that
 * asks the process to stop (lib/on-stop.ts), and -- for whatever SIGKILL
 * left -- at the start of the next run (`sweepPartials`).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { getEncryptionKey } from "@workspace/db/crypto";
import { encryptFile } from "./backup-crypto";
import { countRows, writeCounts } from "./lib/backup-counts";
import { onStop } from "./lib/on-stop";

const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS ?? "30");
/**
 * Where the copy goes: any rclone destination — `offsite:bucket/continuum`
 * with the remote defined by RCLONE_CONFIG_OFFSITE_* settings, or a plain
 * path to a mounted disk. DEPLOY.md, "Backups off the host".
 */
const OFFSITE = process.env.BACKUP_OFFSITE?.trim().replace(/\/+$/, "") ?? "";
/**
 * Unset by default, so nothing here ever deletes from the far side: an
 * attacker, or a bug, that reaches this host should not also be able to
 * empty the copy kept away from it. A lifecycle rule on the bucket is the
 * better way to expire old copies; this is for a destination without one.
 */
const OFFSITE_RETAIN_DAYS = process.env.BACKUP_OFFSITE_RETAIN_DAYS
  ? Number(process.env.BACKUP_OFFSITE_RETAIN_DAYS)
  : null;

function fail(message: string): never {
  console.error(`backup-database: ${message}`);
  process.exit(1);
}

if (!DATABASE_URL) fail("DATABASE_URL is not set. Nothing to back up.");
if (!Number.isFinite(RETAIN_DAYS) || RETAIN_DAYS < 1) {
  fail(
    `BACKUP_RETAIN_DAYS must be a positive number, got "${process.env.BACKUP_RETAIN_DAYS}".`,
  );
}
if (
  OFFSITE_RETAIN_DAYS !== null &&
  (!Number.isFinite(OFFSITE_RETAIN_DAYS) || OFFSITE_RETAIN_DAYS < RETAIN_DAYS)
) {
  // Keeping fewer days off the host than on it would make the off-host copy
  // the one that runs out first, which is backwards.
  fail(
    `BACKUP_OFFSITE_RETAIN_DAYS must be a number no smaller than BACKUP_RETAIN_DAYS (${RETAIN_DAYS}), got "${process.env.BACKUP_OFFSITE_RETAIN_DAYS}".`,
  );
}

/** A filename that sorts chronologically and is safe on every filesystem. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

/** Run a command and hand back what it printed. */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${command} is not installed or not on PATH.`)
          : error,
      );
    });
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command} exited with ${code}.`)),
    );
  });
}

/** Run a command and hand back only what it wrote to stdout. */
function stdoutOf(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`${command} is not installed or not on PATH.`)
          : error,
      );
    });
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command} exited with ${code}: ${err.trim().split("\n").pop() ?? ""}`)),
    );
  });
}

/**
 * Copy one finished backup off this host, and prove it got there.
 *
 * rclone, rather than a storage SDK, because the dump holds every photograph
 * a family uploaded (they live in Postgres) and will run to gigabytes: rclone
 * already does multipart uploads, retries and checksums, and speaks to S3,
 * R2, B2, Spaces, a mounted disk or an SFTP box with the same command. The
 * exit code is not taken on trust; the far side is asked for each file and
 * its size must match.
 *
 * The backup is already encrypted, which is what makes it safe to hand to a
 * storage provider. The key is not in it, and must not be stored beside it.
 * Its counts go with it, so that the copy that comes back on the day it is
 * needed can be verified against them too.
 */
async function sendOffsite(files: string[]): Promise<void> {
  for (const file of files) {
    const destination = `${OFFSITE}/${path.basename(file)}`;

    await stdoutOf("rclone", [
      "copyto",
      "--retries",
      "5",
      "--low-level-retries",
      "20",
      file,
      destination,
    ]);

    const { size } = await stat(file);
    let landed: { Size?: number } = {};
    try {
      landed = JSON.parse(
        await stdoutOf("rclone", ["lsjson", "--stat", destination]),
      ) as { Size?: number };
    } catch (error) {
      throw new Error(
        `rclone reported the copy done, but ${destination} could not be read back: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (landed.Size !== size) {
      throw new Error(
        `${destination} is ${landed.Size ?? "missing"} bytes on the far side and ${size} here.`,
      );
    }
    console.log(`copied off this host to ${destination}`);
  }

  if (OFFSITE_RETAIN_DAYS !== null) {
    // Only names this script writes, as with the local prune.
    await stdoutOf("rclone", [
      "delete",
      "--min-age",
      `${OFFSITE_RETAIN_DAYS}d`,
      "--include",
      "holding-today-*.sql.enc",
      "--include",
      "holding-today-*.sql.enc.counts.json",
      OFFSITE,
    ]);
  }
}

function majorOf(text: string): number | null {
  const match =
    /PostgreSQL\)?\s+(\d+)\./.exec(text) ?? /^\s*(\d+)\./.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Refuse to take a backup with a client that does not match the server.
 *
 * This is not pedantry, and the two failure directions are not symmetrical:
 *
 *   client older than server — pg_dump refuses outright and exits non-zero.
 *   Loud, obvious, and already handled.
 *
 *   client NEWER than server — pg_dump succeeds and writes a dump that will
 *   not restore, because it emits settings the older server has never heard
 *   of (`transaction_timeout`, new in 17, is the one that bit us). psql
 *   aborts on the first such line. The backup looks perfect until the morning
 *   somebody needs it, which is the worst possible time to find out.
 *
 * Nothing downstream can catch that second case: the file exists, it is the
 * right size, and it is garbage. So it is caught here, before a file that
 * cannot be restored is written and counted as a backup.
 */
async function assertVersionsMatch(): Promise<void> {
  const clientText = await capture("pg_dump", ["--version"]);
  const client = majorOf(clientText);

  let serverText: string;
  try {
    serverText = await capture("psql", [
      "--no-psqlrc",
      "--tuples-only",
      "--quiet",
      "--command",
      "show server_version",
      DATABASE_URL!,
    ]);
  } catch (error) {
    // A server we cannot reach is pg_dump's problem to report, with its own
    // much better error message. Do not pre-empt it with a worse one.
    void error;
    return;
  }

  const server = majorOf(serverText.trim());

  if (client === null || server === null) return;

  if (client !== server) {
    fail(
      `pg_dump is version ${client} but the database is version ${server}. ` +
        (client > server
          ? "A newer client writes a dump this server cannot restore, which " +
            "would look like a working backup and not be one. "
          : "An older client will not dump this server at all. ") +
        `Install postgresql-client-${server} (in Docker, build the tools ` +
        `image with --build-arg PG_MAJOR=${server}).`,
    );
  }
}

/** The pg_dump running now, which a signal that stops this run stops too. */
let pgDump: ChildProcess | null = null;

function runPgDump(target: string, snapshot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --clean --if-exists so the dump can be replayed over a database that
    // still has the old schema in it, which is the situation you are in when
    // you are restoring at 3am.
    const child = spawn(
      "pg_dump",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot}`,
        "--file",
        target,
        DATABASE_URL!,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    pgDump = child;

    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("pg_dump is not installed or not on PATH.")
          : error,
      );
    });
    child.on("close", (code) => {
      pgDump = null;
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}.`));
    });
  });
}

type Counted = { takenAt: string; rows: Record<string, number> };

/**
 * The dump, and every table's row count as the dump sees it.
 *
 * The counts are what verify-backup holds a restore to, so they have to be
 * of exactly what the dump holds -- not of the database a moment before or
 * after, which is being written to all day. So a read-only transaction here
 * exports its snapshot, counts each table in it, and hands it to pg_dump
 * with --snapshot: both read the database as it stood at one instant. The
 * transaction stays open until pg_dump is done, as pg_dump keeps its own open
 * for the whole dump anyway, and the locks counting took keep any table from
 * being dropped or altered before pg_dump has it too.
 */
async function dumpWithCounts(target: string): Promise<Counted> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `could not connect to the database: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    await client.query("begin transaction isolation level repeatable read read only");
    const { rows } = await client.query<{ snapshot: string; taken_at: Date }>(
      "select pg_export_snapshot() as snapshot, now() as taken_at",
    );
    const counts = await countRows(client);
    await runPgDump(target, rows[0]!.snapshot);
    return { takenAt: rows[0]!.taken_at.toISOString(), rows: counts };
  } finally {
    // Ending the session ends its transaction, which wrote nothing.
    await client.end().catch(() => {});
  }
}

/**
 * Delete dumps older than the retention window. Deliberately only touches
 * files this script's own naming produces, so pointing BACKUP_DIR at a
 * directory holding anything else cannot delete it.
 */
async function prune(dir: string): Promise<void> {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  const entries = await readdir(dir);

  for (const name of entries) {
    // .sql.enc is what this version writes, with its .counts.json beside it,
    // written a moment later and so aged out with it. Bare .sql is still
    // matched so a deployment upgrading from before backups were encrypted
    // keeps pruning whatever it already has on disk.
    if (!/^holding-today-\d.*\.sql(\.enc)?(\.counts\.json)?$/.test(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await rm(full);
      console.log(`pruned ${name}`);
    }
  }
}

/**
 * Remove what an earlier run left part-way through: this script's `.partial`
 * names and no others, as with prune. The plaintext ones hold everything a
 * family has written. A run stopped by a signal removes its own (see main);
 * these are what SIGKILL leaves, from the out-of-memory killer or a host
 * that lost power, and nothing else would ever remove them. One backup runs
 * at a time, so at the start of a run every partial is a leftover. (Were two
 * ever run at once, the one whose file went would fail loudly, finding it
 * gone, rather than finish a backup with a hole in it.)
 */
async function sweepPartials(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    if (!/^holding-today-\d.*\.partial$/.test(name)) continue;
    await rm(path.join(dir, name), { force: true });
    console.log(`removed ${name}, left by a backup that was stopped part-way`);
  }
}

async function main(): Promise<void> {
  // Before anything is dumped: without a usable key the dump could never be
  // encrypted, and would only be plaintext to throw away.
  getEncryptionKey();
  await assertVersionsMatch();
  await mkdir(BACKUP_DIR, { recursive: true });
  await sweepPartials(BACKUP_DIR);

  const final = path.join(BACKUP_DIR, `holding-today-${timestamp()}.sql.enc`);
  // Partial names until the encrypted copy is in place. A half-written file
  // that is named like a finished backup is worse than no file: it looks like
  // a backup. And the dump is plaintext SQL -- names, addresses, vital
  // statistics, message bodies -- so it never has a finished name at all:
  // it is encrypted straight from its partial one.
  const dump = `${final.slice(0, -".enc".length)}.partial`;
  const sealing = `${final}.partial`;

  console.log(`backing up to ${final}`);
  const settled = onStop([dump, sealing], () => pgDump?.kill("SIGTERM"));
  let counted: Counted;
  try {
    counted = await dumpWithCounts(dump);

    const { size } = await stat(dump);
    if (size === 0) throw new Error("pg_dump wrote nothing. Treating this as a failed backup.");

    // Only the columns the application already encrypts (SSNs, uploaded file
    // bytes) come out of pg_dump as ciphertext. Encrypting the whole file is
    // what makes it safe for the copy-it-off-this-host step below to land
    // somewhere with weaker access control than this database. encryptFile
    // removes the plaintext once the encrypted copy is complete.
    await encryptFile(dump, sealing);
    await rename(sealing, final);
  } finally {
    // Whatever was written before a failure is plaintext, or an encrypted
    // copy cut short, and nothing else would ever remove it: the next run
    // writes to new names, and prune matches only finished ones. After the
    // rename nothing is left at either name, so a backup that worked is
    // untouched.
    await rm(dump, { force: true }).catch(() => {});
    await rm(sealing, { force: true }).catch(() => {});
    settled();
  }

  const { size: encryptedSize } = await stat(final);
  console.log(
    `wrote ${final} (${(encryptedSize / 1024 / 1024).toFixed(1)} MB, encrypted)`,
  );

  const countsFile = await writeCounts(
    {
      backup: path.basename(final),
      bytes: encryptedSize,
      takenAt: counted.takenAt,
      rows: counted.rows,
    },
    final,
  );
  console.log(
    `wrote ${countsFile} (the row counts of ${Object.keys(counted.rows).length} tables, for verify-backup)`,
  );

  await prune(BACKUP_DIR);

  if (!OFFSITE) {
    console.warn(
      "done, but nothing left this host: set BACKUP_OFFSITE to copy each " +
        "backup somewhere else (DEPLOY.md, \"Backups off the host\").",
    );
    return;
  }

  try {
    await sendOffsite([final, countsFile]);
  } catch (error) {
    fail(
      `the backup is on this host at ${final}, but the copy off it failed. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  console.log("done.");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
