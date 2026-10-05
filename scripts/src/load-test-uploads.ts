/**
 * How the API holds up when families send a lot of photographs at once.
 *
 *   API_URL=http://localhost:4300 API_PID=<pid> \
 *     pnpm --filter @workspace/scripts run load-test-uploads -- \
 *     --families 1 --photos 1000 --concurrency 1 --megabytes 3
 *
 * The case it was written for: a family chooses a thousand photographs on a
 * phone and presses add. The portal sends them one at a time per family and
 * waits out the rate limit (`uploadWithPatience`), and this does the same, so
 * `--concurrency 1` is a family and anything higher is a misbehaving client.
 * `--families` runs that many at once, each from its own address (sent as
 * X-Forwarded-For, which an API with no proxy in front of it believes), so
 * the per-family rate limit applies to each as it would in life.
 *
 * While they upload, a bystander — a different family, just opening their
 * page — asks for its session every second. That is the number that matters
 * most: one family's thousand photographs must not make everybody else's
 * portal slow.
 *
 * Never point this at a database anybody uses. It registers a home, opens
 * cases and fills them with noise. A local stack, or a throwaway copy.
 *
 * Reported: photographs per minute, upload latency (p50/p95/p99/max), every
 * refusal by status, the bystander's latency, the API's peak memory when
 * API_PID is given, and what each photograph cost in the database when
 * DATABASE_URL is given. `--out results.json` keeps the raw numbers.
 */
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";

const API = (process.env.API_URL ?? "http://localhost:4300").replace(/\/+$/, "");
const PID = process.env.API_PID ? Number(process.env.API_PID) : null;

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}
function argText(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const FAMILIES = arg("families", 1);
const PHOTOS = arg("photos", 1000);
const CONCURRENCY = arg("concurrency", 1);
const MEGABYTES = arg("megabytes", 3);
/** 12 is an ordinary phone (4032 × 3024); 48 is a recent iPhone's full size. */
const MEGAPIXELS = arg("megapixels", 12);
const DISTINCT = arg("distinct", 16);
const OUT = argText("out");

if (/\b(continuumaftercare\.com|replit\.app)\b/.test(API)) {
  console.error("load-test-uploads: refusing to run against a live address.");
  process.exit(1);
}

/* ---------------------------------------------------------------- numbers */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    max: Math.round(sorted.at(-1) ?? 0),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ----------------------------------------------------------- the pictures */

/**
 * A phone's photograph, as far as the server can tell: the same pixel count
 * and about the same file size. The pixel count is what decides the work —
 * anything over 3000px on its long edge is resized and re-encoded, which is
 * the expensive path and the one every modern phone photograph takes — and
 * noise is how to get the file size right, since a JPEG of noise compresses
 * about as badly as a real photograph's detail. Each one differs, so nothing
 * downstream can get away with doing the work once.
 */
async function makePhotos(): Promise<Blob[]> {
  const width = Math.round(Math.sqrt(MEGAPIXELS * 1e6 * (4 / 3)));
  const height = Math.round(width * 0.75);
  // Measured at quality 88: σ ≈ 43 × the bytes a pixel should cost.
  const sigma = Math.min(120, Math.max(2, (43 * MEGABYTES * 1048576) / (width * height)));
  const photos: Blob[] = [];
  for (let i = 0; i < DISTINCT; i += 1) {
    const jpeg = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: (i * 37) % 255, g: 90, b: 140 },
          noise: { type: "gaussian", mean: 128, sigma },
        },
      })
        .jpeg({ quality: 88 })
        .toBuffer();
    // Made into a Blob once, so each request sends it without copying it.
    photos.push(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
  }
  return photos;
}

/* ------------------------------------------------------------------ setup */

type Family = { index: number; token: string; caseId: number; address: string };

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} from ${response.url}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

async function setUp(): Promise<{ families: Family[]; bystander: Family; cookie: string }> {
  const stamp = Date.now();
  const registered = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      homeName: `Load Test ${stamp}`,
      email: `load-${stamp}@example.test`,
      password: "load-test-not-a-real-home",
      displayName: "Load Test",
    }),
  });
  await json(registered);
  const cookie = (registered.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");

  const asStaff = (path: string, body: unknown) =>
    fetch(`${API}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  const open = async (index: number): Promise<Family> => {
    const created = await json<{ id: number }>(
      await asStaff("/cases", { decedentFirstName: "Load", decedentLastName: `Test ${index}` }),
    );
    const contact = await json<{ link: string }>(
      await asStaff(`/cases/${created.id}/contacts`, { name: `Family ${index}`, role: "next_of_kin" }),
    );
    return {
      index,
      caseId: created.id,
      token: contact.link.split("/f/")[1]!,
      address: `10.77.${Math.floor(index / 250)}.${(index % 250) + 1}`,
    };
  };

  const families: Family[] = [];
  for (let i = 0; i < FAMILIES; i += 1) families.push(await open(i));
  const bystander = await open(FAMILIES);
  return { families, bystander, cookie };
}

/* -------------------------------------------------------------- the run */

type Attempt = { family: number; status: number; ms: number };

async function sendOne(family: Family, photo: Blob, n: number, attempts: Attempt[]): Promise<number> {
  for (let tries = 0; ; tries += 1) {
    const form = new FormData();
    form.append("file", photo, `IMG_${n}.jpg`);
    const started = performance.now();
    let status = 0;
    let retryAfter = 10;
    try {
      const response = await fetch(`${API}/api/family/photos`, {
        method: "POST",
        headers: { authorization: `Bearer ${family.token}`, "x-forwarded-for": family.address },
        body: form,
      });
      status = response.status;
      retryAfter = Number(response.headers.get("retry-after")) || 10;
      await response.arrayBuffer();
    } catch {
      status = -1;
    }
    attempts.push({ family: family.index, status, ms: performance.now() - started });

    // The portal's rule: wait out a 429 as told, up to five tries.
    if (status === 429 && tries < 4) {
      await sleep(Math.min(60, Math.max(1, retryAfter)) * 1000);
      continue;
    }
    return status;
  }
}

async function runFamily(family: Family, photos: Blob[], attempts: Attempt[]): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const n = next;
      next += 1;
      if (n >= PHOTOS) return;
      await sendOne(family, photos[(n + family.index) % photos.length]!, n, attempts);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

function rssOf(pid: number): Promise<number | null> {
  return readFile(`/proc/${pid}/status`, "utf8")
    .then((text) => {
      const match = /VmRSS:\s+(\d+) kB/.exec(text);
      return match ? Number(match[1]) * 1024 : null;
    })
    .catch(() => null);
}

async function databaseBytes(): Promise<{ size: number; uploads: number } | null> {
  if (!process.env.DATABASE_URL) return null;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const size = await client.query<{ size: string }>("select pg_database_size(current_database()) as size");
    const uploads = await client.query<{ n: string }>("select count(*) as n from uploads");
    return { size: Number(size.rows[0]!.size), uploads: Number(uploads.rows[0]!.n) };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  console.log(
    `load-test-uploads: ${FAMILIES} famil${FAMILIES === 1 ? "y" : "ies"} × ${PHOTOS} photographs, ` +
      `${CONCURRENCY} at a time each, ~${MEGABYTES} MB apiece, against ${API}`,
  );
  const photos = await makePhotos();
  const averageBytes = photos.reduce((sum, p) => sum + p.size, 0) / photos.length;
  console.log(
    `  made ${photos.length} distinct ${MEGAPIXELS} MP photographs, ${(averageBytes / 1024 / 1024).toFixed(1)} MB on average`,
  );

  const { families, bystander } = await setUp();
  const before = await databaseBytes();

  const attempts: Attempt[] = [];
  const probe: number[] = [];
  const probeFailures: number[] = [];
  let peakRss = PID ? ((await rssOf(PID)) ?? 0) : 0;
  const baseRss = peakRss;
  let running = true;

  const sampler = (async () => {
    while (running) {
      if (PID) peakRss = Math.max(peakRss, (await rssOf(PID)) ?? 0);
      await sleep(250);
    }
  })();
  const bystanderLoop = (async () => {
    while (running) {
      const started = performance.now();
      try {
        const response = await fetch(`${API}/api/family/session`, {
          headers: { authorization: `Bearer ${bystander.token}`, "x-forwarded-for": bystander.address },
        });
        await response.arrayBuffer();
        if (response.ok) probe.push(performance.now() - started);
        else probeFailures.push(response.status);
      } catch {
        probeFailures.push(-1);
      }
      await sleep(1000);
    }
  })();

  const started = performance.now();
  await Promise.all(families.map((family) => runFamily(family, photos, attempts)));
  const seconds = (performance.now() - started) / 1000;
  running = false;
  await Promise.all([sampler, bystanderLoop]);

  const after = await databaseBytes();

  const byStatus = new Map<number, number>();
  for (const attempt of attempts) byStatus.set(attempt.status, (byStatus.get(attempt.status) ?? 0) + 1);
  const accepted = byStatus.get(201) ?? 0;
  const uploads = summary(attempts.filter((a) => a.status === 201).map((a) => a.ms));

  // The cap holds per case, whatever the concurrency.
  const counts: number[] = [];
  for (const family of families) {
    const listed = await json<unknown[]>(
      await fetch(`${API}/api/family/photos`, {
        headers: { authorization: `Bearer ${family.token}`, "x-forwarded-for": family.address },
      }),
    );
    counts.push(listed.length);
  }

  const result = {
    run: {
      families: FAMILIES,
      photos: PHOTOS,
      concurrency: CONCURRENCY,
      megapixels: MEGAPIXELS,
      averageMegabytes: +(averageBytes / 1024 / 1024).toFixed(2),
    },
    seconds: +seconds.toFixed(1),
    accepted,
    perMinute: +((accepted / seconds) * 60).toFixed(1),
    megabytesPerSecond: +((accepted * averageBytes) / 1024 / 1024 / seconds).toFixed(1),
    statuses: Object.fromEntries([...byStatus.entries()].sort((a, b) => a[0] - b[0])),
    uploadMs: uploads,
    bystanderMs: summary(probe),
    bystanderFailures: probeFailures.length,
    photosPerCase: { max: Math.max(...counts), min: Math.min(...counts) },
    apiMemory: PID ? { baselineMb: Math.round(baseRss / 1048576), peakMb: Math.round(peakRss / 1048576) } : null,
    database:
      before && after
        ? {
            grewMb: Math.round((after.size - before.size) / 1048576),
            bytesPerPhoto: after.uploads > before.uploads
              ? Math.round((after.size - before.size) / (after.uploads - before.uploads))
              : null,
          }
        : null,
  };

  console.log(JSON.stringify(result, null, 2));
  if (OUT) await writeFile(OUT, JSON.stringify({ ...result, attempts }, null, 2));
}

main().catch((error: unknown) => {
  console.error("load-test-uploads:", error instanceof Error ? error.message : error);
  process.exit(1);
});
