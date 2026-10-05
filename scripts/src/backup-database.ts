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
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { encryptFile } from "./backup-crypto";

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
 * exit code is not taken on trust; the far side is asked for the file and
 * its size must match.
 *
 * The file is already encrypted, which is what makes it safe to hand to a
 * storage provider. The key is not in it, and must not be stored beside it.
 */
async function sendOffsite(file: string): Promise<void> {
  const name = path.basename(file);
  const destination = `${OFFSITE}/${name}`;

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

  if (OFFSITE_RETAIN_DAYS !== null) {
    // Only names this script writes, as with the local prune.
    await stdoutOf("rclone", [
      "delete",
      "--min-age",
      `${OFFSITE_RETAIN_DAYS}d`,
      "--include",
      "holding-today-*.sql.enc",
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

function runPgDump(target: string): Promise<void> {
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
        "--file",
        target,
        DATABASE_URL!,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    child.on("error", (error) => {
      reject(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error("pg_dump is not installed or not on PATH.")
          : error,
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}.`));
    });
  });
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
    // .sql.enc is what this version writes; bare .sql is still matched so a
    // deployment upgrading from before backups were encrypted keeps pruning
    // whatever it already has on disk.
    if (!/^holding-today-\d.*\.sql(\.enc)?$/.test(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await rm(full);
      console.log(`pruned ${name}`);
    }
  }
}

async function main(): Promise<void> {
  await assertVersionsMatch();
  await mkdir(BACKUP_DIR, { recursive: true });

  const plain = path.join(BACKUP_DIR, `holding-today-${timestamp()}.sql`);
  // Dump to a partial name first. A half-written file that is named like a
  // finished backup is worse than no file: it looks like a backup.
  const partial = `${plain}.partial`;

  console.log(`backing up to ${plain}`);
  await runPgDump(partial);
  await rename(partial, plain);

  const { size } = await stat(plain);
  if (size === 0) fail(`${plain} is empty. Treating this as a failed backup.`);

  // A pg_dump is mostly plaintext SQL — names, addresses, vital statistics,
  // message bodies. Only the columns the application already encrypts (SSNs,
  // uploaded file bytes) come out as ciphertext on their own. Encrypting the
  // whole file is what makes it safe for the copy-it-off-this-host step
  // below to land somewhere with weaker access control than this database.
  const final = `${plain}.enc`;
  await encryptFile(plain, final);

  const { size: encryptedSize } = await stat(final);
  console.log(
    `wrote ${final} (${(encryptedSize / 1024 / 1024).toFixed(1)} MB, encrypted)`,
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
    await sendOffsite(final);
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
