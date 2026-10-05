/**
 * How many rows each table held when a backup was taken, kept beside it.
 *
 * verify-backup used to compare what a restore brought back with the live
 * database at the moment it ran. A database in use is written to all day, so
 * one family's photograph or one director's note since the dump made a sound
 * backup read as a broken one -- and a check that cries wolf every night is
 * one people learn to ignore. What a backup should be held to is what the
 * database held when it was taken, so backup-database counts every table in
 * the same snapshot pg_dump reads (see `pg_export_snapshot` there) and
 * writes the numbers down here.
 *
 * The file is `<backup>.counts.json`: the backup's own name with more on the
 * end, so the glob, prune or copy that takes a backup takes its counts with
 * it. It is not encrypted. It holds table names and numbers and nothing
 * anybody wrote, and verify-backup can read it before it has decrypted
 * anything.
 */
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

export function countsFileFor(backup: string): string {
  return `${backup}.counts.json`;
}

export type BackupCounts = {
  /** The backup these describe, by name, and its size in bytes. */
  backup: string;
  bytes: number;
  /** When the snapshot they were counted in was taken. */
  takenAt: string;
  rows: Record<string, number>;
};

/**
 * Every table in the public schema, by name, with its row count, as the
 * client's transaction sees them.
 */
export async function countRows(
  client: pg.ClientBase,
): Promise<Record<string, number>> {
  const { rows: tables } = await client.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by tablename",
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${client.escapeIdentifier(name)}`,
    );
    counts[name] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

/** Written to a partial name and renamed, like the backup it describes. */
export async function writeCounts(counts: BackupCounts, beside: string): Promise<string> {
  const file = countsFileFor(beside);
  const partial = `${file}.partial`;
  try {
    await writeFile(partial, `${JSON.stringify(counts, null, 2)}\n`);
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
  return file;
}

/**
 * The counts recorded beside a backup, or null for a backup taken before
 * they were. A file that is there but is not what this module writes, or
 * describes some other backup, is an error: comparing against the wrong
 * numbers is worse than comparing against none.
 */
export async function readCounts(
  backup: string,
  bytes: number,
): Promise<BackupCounts | null> {
  const file = countsFileFor(backup);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let counts: BackupCounts;
  try {
    counts = JSON.parse(text) as BackupCounts;
  } catch {
    throw new Error(`${path.basename(file)} is not the JSON backup-database writes.`);
  }
  const rows = counts?.rows;
  if (
    !rows ||
    typeof rows !== "object" ||
    !Object.values(rows).every((n) => Number.isInteger(n) && n >= 0)
  ) {
    throw new Error(`${path.basename(file)} has no row counts in it.`);
  }
  if (counts.backup !== path.basename(backup) || counts.bytes !== bytes) {
    throw new Error(
      `${path.basename(file)} describes ${counts.backup} (${counts.bytes} bytes), ` +
        `not ${path.basename(backup)} (${bytes} bytes).`,
    );
  }
  return counts;
}

export type Comparison = {
  /** One line per recorded table, in name order. */
  lines: string[];
  mismatches: number;
  /** Rows restored, across the recorded tables. */
  total: number;
  /** Tables in the scratch database that the backup does not name. */
  others: string[];
};

/**
 * The restored counts against the recorded ones, table by table. The dump
 * and the counts come from one snapshot and name the same tables, so a
 * recorded table that did not come back is a mismatch. A table the counts do
 * not name is not the backup's at all: the restore drops and recreates what
 * the dump holds, and leaves anything else in the scratch database -- a
 * table this schema has since dropped, from the last time it was used.
 */
export function compareCounts(
  recorded: Record<string, number>,
  restored: Record<string, number>,
): Comparison {
  const lines: string[] = [];
  let mismatches = 0;
  let total = 0;

  for (const table of Object.keys(recorded).sort()) {
    const before = recorded[table];
    const after = restored[table];
    total += after ?? 0;
    if (before === after) {
      lines.push(`  ${table}: ${after}`);
      continue;
    }
    mismatches += 1;
    lines.push(
      `  ${table}: ${before} recorded, ${after ?? "none"} restored  <- MISMATCH`,
    );
  }

  const others = Object.keys(restored)
    .filter((table) => !(table in recorded))
    .sort();
  return { lines, mismatches, total, others };
}
