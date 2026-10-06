import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksLikePgDump } from "./dump-head";

// How a plain-format pg_dump starts.
const HEADER =
  "--\n-- PostgreSQL database dump\n--\n\n" +
  "-- Dumped from database version 16.4\n-- Dumped by pg_dump version 16.4\n\n";

test("reads the head of a dump past 2 GiB, which reading the whole file could not", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dump-head-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "holding-today-big.sql");

  // Sparse: over 2 GiB to anything that asks its size, one block on disk.
  const handle = await open(file, "w");
  try {
    await handle.write(HEADER, 0);
    await handle.truncate(2 ** 31 + 4096);
  } finally {
    await handle.close();
  }

  // What restore-database and verify-backup used to do before a restore.
  await assert.rejects(readFile(file), { code: "ERR_FS_FILE_TOO_LARGE" });
  assert.equal(await looksLikePgDump(file), true);
});

test("still refuses a file that is not a dump", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "dump-head-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const at = (name: string) => path.join(dir, name);

  await writeFile(at("small.sql"), HEADER);
  await writeFile(at("empty.sql"), "");
  // An encrypted backup handed over as if it were plain: version byte, then noise.
  await writeFile(at("renamed.sql"), Buffer.concat([Buffer.from([1]), randomBytes(8192)]));
  // Only the head counts; the words further in are not a dump's header.
  await writeFile(at("buried.sql"), "x".repeat(4096) + HEADER);

  assert.equal(await looksLikePgDump(at("small.sql")), true);
  assert.equal(await looksLikePgDump(at("empty.sql")), false);
  assert.equal(await looksLikePgDump(at("renamed.sql")), false);
  assert.equal(await looksLikePgDump(at("buried.sql")), false);
});
