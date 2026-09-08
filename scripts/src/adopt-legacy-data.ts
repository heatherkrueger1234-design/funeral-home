/**
 * One-time migration from the single-tenant schema to per-account data.
 *
 * The pre-auth database has no notion of an owner, so every row in it belongs
 * to whoever was running the app. Adding `user_id NOT NULL` with a plain
 * `drizzle-kit push` would refuse to run — or, worse, drop those rows. For a
 * database holding what this one holds, losing them is not an acceptable
 * outcome of a schema change.
 *
 * So this script does the safe three-step instead: add the column nullable,
 * adopt every existing row into a named account, and only then tighten the
 * constraint. It is idempotent — running it twice is harmless — and it never
 * deletes anything.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run adopt-legacy-data -- \
 *     --email you@example.com --password 'a long passphrase'
 *
 * Afterwards `pnpm --filter @workspace/db run push` should report no changes.
 */
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// Must stay in step with artifacts/api-server/src/lib/auth.ts.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

const OWNED_TABLES = [
  "profile",
  "memories",
  "journal_entries",
  "letters",
  "creative_works",
  "documents",
  "quotes_songs",
  "tribute",
  "todos",
  "affirmations",
  "milestones",
  "stories",
] as const;

const MIN_PASSWORD_LENGTH = 10;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      "display-name": { type: "string" },
    },
    // pnpm forwards its own `--` separator through to the script. To
    // parseArgs a bare `--` means "everything after this is positional",
    // which would swallow every flag, so it is dropped first.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
  });

  const email = values.email?.trim().toLowerCase();
  const password = values.password;

  if (!email || !password) {
    throw new Error(
      "Both --email and --password are required.\n" +
        "  pnpm --filter @workspace/scripts run adopt-legacy-data -- \\\n" +
        "    --email you@example.com --password 'a long passphrase'",
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `--password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // One transaction: either the whole migration lands or none of it does.
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        email text NOT NULL,
        password_hash text NOT NULL,
        display_name text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`,
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamp NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)`,
    );

    const existing = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );

    let userId: number;

    if (existing.rows.length > 0) {
      userId = existing.rows[0].id;
      console.log(`Using existing account ${email} (id ${userId}).`);
    } else {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [email, await hashPassword(password), values["display-name"] ?? null],
      );
      userId = inserted.rows[0].id;
      console.log(`Created account ${email} (id ${userId}).`);
    }

    let adoptedTotal = 0;

    for (const table of OWNED_TABLES) {
      const present = await client.query<{ exists: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`public.${table}`],
      );

      if (!present.rows[0].exists) {
        console.log(`  ${table}: table does not exist yet, skipping.`);
        continue;
      }

      // Step 1 — nullable, so it can be added to a table that already has rows.
      await client.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id integer`,
      );

      // Step 2 — adopt everything written before accounts existed.
      const adopted = await client.query(
        `UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`,
        [userId],
      );
      adoptedTotal += adopted.rowCount ?? 0;

      // Step 3 — only now can the constraint be enforced.
      await client.query(
        `ALTER TABLE ${table} ALTER COLUMN user_id SET NOT NULL`,
      );
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE ${table}
            ADD CONSTRAINT ${table}_user_id_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${table}_user_id_idx ON ${table} (user_id)`,
      );

      console.log(`  ${table}: adopted ${adopted.rowCount ?? 0} row(s).`);
    }

    await client.query("COMMIT");
    console.log(
      `\nDone. ${adoptedTotal} row(s) now belong to ${email}. ` +
        `Sign in with that address to see them.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\nMigration rolled back — the database is unchanged.");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
