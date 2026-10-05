/**
 * backup-database, stopped part-way, with stand-ins for pg_dump and psql
 * first on PATH.
 *
 * The stand-in pg_dump writes the head of a dump, plaintext and all, to the
 * file it was given -- then waits, as a real one does over a large database,
 * until it is killed. That is the moment a deploy, `docker compose stop` or a
 * Ctrl-C arrives in real life.
 *
 * The script still counts the tables of a real database before it dumps
 * (lib/backup-counts.ts), and that database is not DATABASE_URL itself: the
 * API's suite may be running beside this one against it, truncating every
 * table before each test, and a TRUNCATE that arrives while a backup is
 * counting in its snapshot can deadlock with it. The server's own `postgres`
 * database has none of our tables, which is all a dump that never happens
 * needs. BACKUP_TEST_DATABASE_URL names another, if that one is out of reach.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dirname, "backup-database.ts");
const DUMP_TEXT = "COPY public.case_messages (body) FROM stdin;\nMum would have hated the hymns.\n";

async function standIns(dir: string): Promise<string> {
  const bin = path.join(dir, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "pg_dump"),
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "pg_dump (PostgreSQL) 16.4"; exit 0; fi
out=""
for arg in "$@"; do
  case "$prev" in --file) out="$arg" ;; esac
  prev="$arg"
done
printf '%s\\n' '--' '-- PostgreSQL database dump' '--' > "$out"
printf '${DUMP_TEXT.replaceAll("\n", "\\n")}' >> "$out"
echo $$ > "${dir}/pg_dump.pid"
[ -n "$STAND_IN_FINISH" ] && exit 0
exec sleep 30
`,
  );
  // No server to ask for its version: the check steps aside, as it does for
  // any server it cannot reach.
  await writeFile(path.join(bin, "psql"), "#!/bin/sh\nexit 2\n");
  await chmod(path.join(bin, "pg_dump"), 0o755);
  await chmod(path.join(bin, "psql"), 0o755);
  return bin;
}

function quietDatabase(): string {
  const chosen = process.env["BACKUP_TEST_DATABASE_URL"];
  if (chosen) return chosen;
  const server = process.env["DATABASE_URL"];
  assert.ok(server, "DATABASE_URL must name the Postgres server the suites use");
  const url = new URL(server);
  url.pathname = "/postgres";
  return url.toString();
}

function backup(dir: string, bin: string, extra: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", SCRIPT], {
    cwd: path.dirname(import.meta.dirname),
    env: {
      PATH: `${bin}:${process.env["PATH"]}`,
      HOME: process.env["HOME"],
      DATABASE_URL: quietDatabase(),
      BACKUP_DIR: path.join(dir, "backups"),
      // The fixed key CI uses; never a deployed secret.
      ENCRYPTION_KEY:
        process.env["ENCRYPTION_KEY"] ?? "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function finished(child: ChildProcess): Promise<{ code: number | null; output: string }> {
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, output })));
}

/** Until pg_dump has written plaintext and is waiting. */
async function dumping(dir: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const names = await readdir(path.join(dir, "backups")).catch(() => []);
    const partial = names.find((name) => name.endsWith(".sql.partial"));
    if (partial && existsSync(path.join(dir, "pg_dump.pid"))) {
      const text = await readFile(path.join(dir, "backups", partial), "utf8");
      if (text.includes("Mum would have hated")) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("pg_dump never started writing");
}

/** Gone, or a zombie waiting to be reaped: either way, not dumping. */
async function dead(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i += 1) {
    if (!existsSync(`/proc/${pid}`)) return true;
    if (/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, "utf8"))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function plaintextIn(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of await readdir(dir)) {
    const text = await readFile(path.join(dir, name), "latin1");
    if (text.includes("Mum would have hated")) found.push(name);
  }
  return found;
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`leaves no plaintext when stopped by ${signal} mid-dump`, async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "backup-signal-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const bin = await standIns(dir);

    const child = backup(dir, bin);
    const done = finished(child);
    await dumping(dir);
    child.kill(signal);
    const { code, output } = await done;

    assert.deepEqual(await readdir(path.join(dir, "backups")), []);
    assert.equal(code, signal === "SIGTERM" ? 143 : 130, output);
    assert.match(output, new RegExp(`stopped by ${signal}; removed .*\\.sql\\.partial`));
    const pid = Number(await readFile(path.join(dir, "pg_dump.pid"), "utf8"));
    assert.ok(await dead(pid), "pg_dump is still running");
  });
}

test("sweeps the partial files a killed run left, and only this script's", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-signal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = await standIns(dir);

  // SIGKILL cannot be caught: this is the out-of-memory killer, or the host
  // losing power, and it leaves the plaintext where it lay.
  const first = backup(dir, bin);
  const firstDone = finished(first);
  await dumping(dir);
  first.kill("SIGKILL");
  process.kill(Number(await readFile(path.join(dir, "pg_dump.pid"), "utf8")), "SIGKILL");
  await firstDone;
  const backups = path.join(dir, "backups");
  assert.equal((await plaintextIn(backups)).length, 1);

  await writeFile(path.join(backups, "holding-today-2026-10-01T03-30-00-000.sql.enc.partial"), "half");
  await writeFile(path.join(backups, "somebody-elses.partial"), "keep me");

  const second = await finished(backup(dir, bin, { STAND_IN_FINISH: "1" }));
  assert.equal(second.code, 0, second.output);

  const left = (await readdir(backups)).sort();
  assert.deepEqual(await plaintextIn(backups), []);
  assert.ok(left.includes("somebody-elses.partial"));
  assert.ok(!left.some((name) => name.startsWith("holding-today-") && name.endsWith(".partial")));
  assert.equal(left.filter((name) => name.endsWith(".sql.enc")).length, 1);
  for (const name of left) assert.ok((await stat(path.join(backups, name))).size > 0);
});
