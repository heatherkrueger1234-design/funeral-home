import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareCounts,
  countsFileFor,
  readCounts,
  writeCounts,
} from "./backup-counts";

const BACKUP = "holding-today-2026-10-05T03-30-00-000.sql.enc";

test("goes wherever its backup's name goes", () => {
  const file = countsFileFor(`/backups/${BACKUP}`);
  assert.equal(file, `/backups/${BACKUP}.counts.json`);
  // The off-host fetch in DEPLOY.md takes `holding-today-*`, and prune and
  // rclone take the backup's own name with anything after it.
  assert.ok(path.basename(file).startsWith(BACKUP));
});

test("compares with what the database held when the dump was taken", () => {
  const recorded = { cases: 12, uploads: 340, users: 4 };

  // Rows written since the dump are the live database's business, not the
  // backup's: the restore is held to the counts it was taken with.
  const same = compareCounts(recorded, { cases: 12, uploads: 340, users: 4 });
  assert.equal(same.mismatches, 0);
  assert.equal(same.total, 356);
  assert.deepEqual(same.lines, ["  cases: 12", "  uploads: 340", "  users: 4"]);

  const short = compareCounts(recorded, { cases: 12, uploads: 339, users: 4 });
  assert.equal(short.mismatches, 1);
  assert.match(short.lines[1]!, /uploads: 340 recorded, 339 restored .*MISMATCH/);
});

test("counts a recorded table that did not come back as a mismatch", () => {
  const result = compareCounts({ cases: 1, uploads: 2 }, { cases: 1 });
  assert.equal(result.mismatches, 1);
  assert.match(result.lines.join("\n"), /uploads: 2 recorded, none restored .*MISMATCH/);
});

test("leaves the scratch database's other tables out of it", () => {
  // A table this schema has since dropped, left behind by last week's
  // restore into the same scratch database: not the backup's to answer for.
  const result = compareCounts({ cases: 1 }, { cases: 1, old_notes: 7 });
  assert.equal(result.mismatches, 0);
  assert.equal(result.total, 1);
  assert.deepEqual(result.others, ["old_notes"]);
});

test("reads back what it wrote, and nothing is left at a partial name", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-counts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backup = path.join(dir, BACKUP);

  const counts = {
    backup: BACKUP,
    bytes: 1234,
    takenAt: "2026-10-05T03:30:00.000Z",
    rows: { cases: 12, uploads: 340 },
  };
  await writeCounts(counts, backup);

  assert.deepEqual(await readdir(dir), [`${BACKUP}.counts.json`]);
  assert.deepEqual(await readCounts(backup, 1234), counts);
});

test("has nothing to say about a backup taken before counts were kept", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-counts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.equal(await readCounts(path.join(dir, BACKUP), 1234), null);
});

test("refuses counts that describe some other backup, or are not counts", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "backup-counts-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const backup = path.join(dir, BACKUP);
  const rows = { cases: 12 };

  // The right name, the wrong size: not the file they were counted with.
  await writeCounts({ backup: BACKUP, bytes: 999, takenAt: "", rows }, backup);
  await assert.rejects(readCounts(backup, 1234), /describes .* not /);

  await writeCounts({ backup: "holding-today-other.sql.enc", bytes: 1234, takenAt: "", rows }, backup);
  await assert.rejects(readCounts(backup, 1234), /describes holding-today-other/);

  await writeFile(countsFileFor(backup), "{ not json");
  await assert.rejects(readCounts(backup, 1234), /not the JSON/);

  await writeFile(countsFileFor(backup), JSON.stringify({ backup: BACKUP, bytes: 1234, rows: { cases: -1 } }));
  await assert.rejects(readCounts(backup, 1234), /no row counts/);
});
