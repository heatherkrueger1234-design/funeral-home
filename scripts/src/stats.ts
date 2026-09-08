/**
 * How many people are using this, and how much.
 *
 *   pnpm --filter @workspace/scripts run stats
 *
 * Counts only. This script never selects a title, a body, an email address or
 * a filename, and it must never be edited to. Owning the database does not
 * make somebody's journal yours to read — a parent writing at four in the
 * morning is entitled to assume nobody is on the other side of it, and the
 * only honest way to keep that promise is for the tool that answers "is
 * anyone using this" to be incapable of answering "what did they say".
 *
 * What it cannot tell you: anyone reading the guides without an account. The
 * guides are deliberately open to people who will never sign up — a parent in
 * a hospital corridor at 2am is not going to register for anything first — and
 * nothing here logs them. Counting those requires analytics, which is a
 * separate decision with its own costs.
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("\n  DATABASE_URL is not set. Point it at the database the site uses.\n");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function scalar(sql: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql);
  return Number(rows[0]?.n ?? 0);
}

/** Tables holding things a person made, in the order they appear in the app. */
const KEPT: { table: string; label: string }[] = [
  { table: "memories", label: "Memories" },
  { table: "uploads", label: "Photos and files" },
  { table: "albums", label: "Albums" },
  { table: "journal_entries", label: "Journal entries" },
  { table: "letters", label: "Letters" },
  { table: "quotes_songs", label: "Quotes and songs" },
  { table: "signs", label: "Signs" },
  { table: "stories", label: "Stories others shared" },
  { table: "creative_works", label: "Creative work" },
  { table: "keepsakes", label: "Small questions answered" },
  { table: "documents", label: "Documents in the vault" },
  { table: "milestones", label: "Dates in the calendar" },
  { table: "todos", label: "To-dos" },
  { table: "belongings", label: "Belongings tracked" },
  { table: "contacts", label: "People to tell" },
  { table: "obituaries", label: "Obituaries" },
  { table: "memorial_choices", label: "Memorial choices" },
  { table: "tribute", label: "Tributes" },
  { table: "affirmations", label: "Affirmations" },
  { table: "shares", label: "Share links made" },
];

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function bar(value: number, max: number, width = 22): string {
  if (max <= 0) return "";
  return "▍".repeat(Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width)));
}

async function main(): Promise<void> {
  const rule = "─".repeat(56);

  // ---------------------------------------------------------- people -----
  const total = await scalar("SELECT count(*) AS n FROM users");
  const new7 = await scalar(
    "SELECT count(*) AS n FROM users WHERE created_at > now() - interval '7 days'",
  );
  const new30 = await scalar(
    "SELECT count(*) AS n FROM users WHERE created_at > now() - interval '30 days'",
  );

  // A session row is created on each sign-in, so distinct users across recent
  // sessions is the closest thing to "came back" that exists here.
  const active7 = await scalar(
    "SELECT count(DISTINCT user_id) AS n FROM sessions WHERE created_at > now() - interval '7 days'",
  );
  const active30 = await scalar(
    "SELECT count(DISTINCT user_id) AS n FROM sessions WHERE created_at > now() - interval '30 days'",
  );
  const live = await scalar(
    "SELECT count(DISTINCT user_id) AS n FROM sessions WHERE expires_at > now()",
  );

  console.log(`\n  HOLDING TODAY\n  ${rule}\n`);
  console.log("  People with an account");
  console.log(`    ${String(total).padStart(6)}   in total`);
  console.log(`    ${String(new30).padStart(6)}   joined in the last 30 days`);
  console.log(`    ${String(new7).padStart(6)}   joined in the last 7 days`);
  console.log();
  console.log("  People coming back");
  console.log(`    ${String(active30).padStart(6)}   signed in within 30 days`);
  console.log(`    ${String(active7).padStart(6)}   signed in within 7 days`);
  console.log(`    ${String(live).padStart(6)}   still have a session open`);

  // ------------------------------------------------------ what is kept ----
  const kept = await Promise.all(
    KEPT.map(async (entry) => ({
      label: entry.label,
      count: await scalar(`SELECT count(*) AS n FROM ${entry.table}`),
    })),
  );
  const busiest = Math.max(...kept.map((k) => k.count), 1);
  const keptTotal = kept.reduce((sum, k) => sum + k.count, 0);

  console.log(`\n  ${rule}\n`);
  console.log(`  What people are keeping here — ${keptTotal} things in all\n`);
  for (const { label, count } of kept.filter((k) => k.count > 0)) {
    console.log(
      `    ${String(count).padStart(6)}  ${label.padEnd(26)} ${bar(count, busiest)}`,
    );
  }
  const empty = kept.filter((k) => k.count === 0).map((k) => k.label);
  if (empty.length > 0) {
    console.log(`\n    Nothing yet in: ${empty.join(", ").toLowerCase()}`);
  }

  // ---------------------------------------------------------- the room ----
  const posts = await scalar("SELECT count(*) AS n FROM community_posts WHERE hidden_at IS NULL");
  const comments = await scalar(
    "SELECT count(*) AS n FROM community_comments WHERE hidden_at IS NULL",
  );
  const hidden = await scalar("SELECT count(*) AS n FROM community_posts WHERE hidden_at IS NOT NULL");
  const reports = await scalar("SELECT count(*) AS n FROM community_reports");
  const voices = await scalar(
    "SELECT count(DISTINCT user_id) AS n FROM community_posts WHERE hidden_at IS NULL",
  );

  console.log(`\n  ${rule}\n`);
  console.log("  The room");
  console.log(`    ${String(posts).padStart(6)}   posts, from ${voices} different people`);
  console.log(`    ${String(comments).padStart(6)}   replies`);
  if (reports > 0 || hidden > 0) {
    console.log(`    ${String(reports).padStart(6)}   reported${hidden > 0 ? `, ${hidden} hidden` : ""}`);
  }

  // ----------------------------------------------------------- storage ----
  const stored = await scalar("SELECT coalesce(sum(size_bytes), 0) AS n FROM uploads");
  const files = await scalar("SELECT count(*) AS n FROM uploads");

  console.log(`\n  ${rule}\n`);
  console.log("  Storage");
  console.log(`    ${bytes(stored)} across ${files} file${files === 1 ? "" : "s"}`);

  console.log(`\n  ${rule}`);
  console.log("  Counts only. This never reads what anyone wrote.");
  console.log("  People reading the guides without an account are not counted;");
  console.log("  nothing here logs them.\n");
}

main()
  .catch((error: unknown) => {
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  })
  .finally(() => pool.end());
