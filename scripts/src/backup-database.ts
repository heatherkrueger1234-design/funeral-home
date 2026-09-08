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
 * Run it on a schedule, and copy BACKUP_DIR somewhere that is not this host.
 * A backup on the same disk as the database does not survive the failure it
 * exists for.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS ?? "30");

function fail(message: string): never {
  console.error(`backup-database: ${message}`);
  process.exit(1);
}

if (!DATABASE_URL) fail("DATABASE_URL is not set. Nothing to back up.");
if (!Number.isFinite(RETAIN_DAYS) || RETAIN_DAYS < 1) {
  fail(`BACKUP_RETAIN_DAYS must be a positive number, got "${process.env.BACKUP_RETAIN_DAYS}".`);
}

/** A filename that sorts chronologically and is safe on every filesystem. */
function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

function runPgDump(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --clean --if-exists so the dump can be replayed over a database that
    // still has the old schema in it, which is the situation you are in when
    // you are restoring at 3am.
    const child = spawn(
      "pg_dump",
      ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--file", target, DATABASE_URL!],
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
    if (!/^holding-today-\d.*\.sql$/.test(name)) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await rm(full);
      console.log(`pruned ${name}`);
    }
  }
}

async function main(): Promise<void> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const final = path.join(BACKUP_DIR, `holding-today-${timestamp()}.sql`);
  // Dump to a partial name first. A half-written file that is named like a
  // finished backup is worse than no file: it looks like a backup.
  const partial = `${final}.partial`;

  console.log(`backing up to ${final}`);
  await runPgDump(partial);
  await rename(partial, final);

  const { size } = await stat(final);
  if (size === 0) fail(`${final} is empty. Treating this as a failed backup.`);
  console.log(`wrote ${final} (${(size / 1024 / 1024).toFixed(1)} MB)`);

  await prune(BACKUP_DIR);
  console.log("done. Now make sure a copy of this directory lives off this host.");
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
