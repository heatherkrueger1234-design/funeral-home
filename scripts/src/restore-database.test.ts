/**
 * restore-database, stopped part-way. It decrypts the backup to a plaintext
 * file beside it before psql reads it; stopped while psql is still reading,
 * it must take that file with it. A stand-in psql first on PATH stands for a
 * long restore, so no database is touched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptFile } from "./backup-crypto";

// The fixed key CI uses (.github/workflows/*.yml); never a deployed secret.
process.env.ENCRYPTION_KEY ??= "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

test("leaves no decrypted copy behind when stopped by SIGTERM mid-restore", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "restore-signal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const bin = path.join(dir, "bin");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "psql"),
    `#!/bin/sh\necho $$ > "${dir}/psql.pid"\nexec sleep 30\n`,
  );
  await chmod(path.join(bin, "psql"), 0o755);

  const backups = path.join(dir, "backups");
  await mkdir(backups);
  const plain = path.join(backups, "holding-today-2026-10-05T03-30-00-000.sql");
  await writeFile(
    plain,
    "--\n-- PostgreSQL database dump\n--\n\nCOPY public.case_messages (body) FROM stdin;\nMum would have hated the hymns.\n\\.\n",
  );
  const backup = `${plain}.enc`;
  await encryptFile(plain, backup);

  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join(import.meta.dirname, "restore-database.ts"), "--file", backup, "--yes"],
    {
      cwd: path.dirname(import.meta.dirname),
      env: {
        PATH: `${bin}:${process.env["PATH"]}`,
        HOME: process.env["HOME"],
        // Never reached: the stand-in psql connects to nothing.
        DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
        ENCRYPTION_KEY: process.env["ENCRYPTION_KEY"],
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const done = new Promise<number | null>((resolve) => child.on("close", resolve));

  // psql has started on the decrypted copy.
  for (let i = 0; i < 200 && !existsSync(path.join(dir, "psql.pid")); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const decrypted = (await readdir(backups)).filter((name) => name.includes(".restore-"));
  assert.equal(decrypted.length, 1, output);

  child.kill("SIGTERM");
  // The stand-in has the restore's pipes open; it is the test's to end.
  process.kill(Number(await readFile(path.join(dir, "psql.pid"), "utf8")), "SIGKILL");
  const code = await done;

  assert.deepEqual(await readdir(backups), [path.basename(backup)]);
  assert.equal(code, 143, output);
  assert.match(output, /stopped by SIGTERM; removed .*\.restore-\d+\.tmp/);
});
