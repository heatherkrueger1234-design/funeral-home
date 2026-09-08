/**
 * Load the US ZIP centroids that make proximity search work.
 *
 *   pnpm --filter @workspace/scripts run load-postal-codes
 *
 * Idempotent, and safe to re-run when the Census publishes a new gazetteer:
 * rows are upserted by ZIP, so a moved centroid is corrected and nothing is
 * duplicated. Takes a couple of seconds for all 33,791.
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db, pool, postalCodesTable } from "@workspace/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(
  here,
  "..",
  "..",
  "lib",
  "db",
  "data",
  "zcta-centroids.csv.gz",
);

type Row = { code: string; latitude: number; longitude: number };

async function main(): Promise<void> {
  const stream = createReadStream(dataFile).pipe(createGunzip());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let batch: Row[] = [];
  let loaded = 0;
  let skipped = 0;

  // Batched rather than row-at-a-time: 33,791 round trips takes minutes,
  // and one statement per thousand takes seconds.
  const flush = async () => {
    if (batch.length === 0) return;

    await db
      .insert(postalCodesTable)
      .values(batch)
      .onConflictDoUpdate({
        target: postalCodesTable.code,
        set: {
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
        },
      });

    loaded += batch.length;
    batch = [];
  };

  for await (const line of lines) {
    const [code, lat, lon] = line.split(",");

    const latitude = Number(lat);
    const longitude = Number(lon);

    if (!code || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      skipped += 1;
      continue;
    }

    batch.push({ code: code.trim(), latitude, longitude });

    if (batch.length >= 1000) await flush();
  }

  await flush();

  console.log(`Loaded ${loaded} postal codes${skipped ? `, skipped ${skipped}` : ""}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
