/**
 * Whether a file begins the way a plain-format pg_dump does, judged from its
 * first 4 KB alone.
 *
 * restore-database and verify-backup both ask this before letting psql near
 * a file, and both used to read the whole dump into memory to answer it.
 * Node refuses to read a file over 2 GiB that way at all. Photographs are in
 * the dump, as bytea, which plain-format pg_dump writes out as hex at twice
 * their size, so about a gigabyte of them made a backup that was taken every
 * night and could be neither restored nor verified. The weekly drill restores
 * seed data, nowhere near that size, so it was never going to notice.
 */
import { open } from "node:fs/promises";

const HEAD_BYTES = 4096;

export async function looksLikePgDump(file: string): Promise<boolean> {
  const head = Buffer.alloc(HEAD_BYTES);
  const handle = await open(file, "r");
  try {
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
    return head
      .subarray(0, bytesRead)
      .toString("utf8")
      .includes("PostgreSQL database dump");
  } finally {
    await handle.close();
  }
}
