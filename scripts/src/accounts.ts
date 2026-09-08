/**
 * Look at the accounts in this database, and set a password on one.
 *
 * This exists because of a real trap. An account created through Google has no
 * password, and by design the API refuses to say so — password sign-in returns
 * the same "email or password is incorrect" it gives an address that was never
 * registered, so that the answer cannot be used to discover whether somebody
 * has an account here. Registering the same address then answers "an account
 * already exists".
 *
 * That is the right privacy trade for strangers probing the site. But it means
 * a person whose account has no password, on a deployment where Google is not
 * configured and SMTP is not set, sees a password box that always refuses, no
 * Google button, and no "forgot password" link. There is no way back in.
 *
 * Until SMTP is configured, this script is the recovery path. It has to be run
 * by somebody with the database credentials, which is the only authorisation
 * that means anything here.
 *
 *   pnpm --filter @workspace/scripts run accounts -- --list
 *   pnpm --filter @workspace/scripts run accounts -- \
 *     --email you@example.com --password 'a long passphrase'
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

// Raw pg rather than the Drizzle client, matching the other scripts here: a
// recovery tool should keep working even when the schema and the ORM's model
// of it have drifted apart, which is exactly when it tends to be needed.
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("\n  DATABASE_URL is not set. Point it at the database the site uses.\n");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * These must match `artifacts/api-server/src/lib/auth.ts` exactly, or the
 * password this writes will not verify at sign-in. The parameters are also
 * stored inside the hash string, so the server reads them back from there
 * rather than assuming — but the *format* has to line up.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MIN_PASSWORD_LENGTH = 10;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Proves the hash this script wrote is one the server will accept. */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const derived = await scrypt(
    password,
    Buffer.from(rawSalt!, "base64"),
    KEY_LENGTH,
    { N: Number(rawN), r: Number(rawR), p: Number(rawP) },
  );
  const expected = Buffer.from(rawHash!, "base64");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

type Row = {
  id: number;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  created_at: Date;
};

async function list(): Promise<void> {
  const { rows: users } = await pool.query<Row>(
    "SELECT id, email, password_hash, google_id, created_at FROM users ORDER BY id",
  );

  if (users.length === 0) {
    console.log("\n  No accounts in this database at all.");
    console.log("  If you expected one, you are pointed at a different database");
    console.log("  than the one you registered on.\n");
    return;
  }

  console.log(`\n  ${users.length} account(s) in this database:\n`);
  for (const user of users) {
    const how = [
      user.password_hash ? "password" : null,
      user.google_id ? "Google" : null,
    ].filter(Boolean);

    console.log(`  #${user.id}  ${user.email}`);
    console.log(
      `        signs in with: ${how.length ? how.join(" and ") : "NOTHING — cannot sign in"}`,
    );
    console.log(`        created ${user.created_at.toISOString().slice(0, 10)}`);
  }

  const stranded = users.filter((u) => !u.password_hash);
  if (stranded.length > 0) {
    console.log(
      `\n  ${stranded.length} of these have no password. If Google sign-in is not`,
    );
    console.log("  configured on this deployment, they cannot get in at all.");
    console.log("  Give one a password with:\n");
    console.log(
      `    pnpm --filter @workspace/scripts run accounts -- --email ${stranded[0]!.email} --password 'a long passphrase'`,
    );
  }
  console.log();
}

async function setPassword(rawEmail: string, password: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();

  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const { rows } = await pool.query<{ id: number; email: string; google_id: string | null }>(
    "SELECT id, email, google_id FROM users WHERE email = $1 LIMIT 1",
    [email],
  );
  const user = rows[0];

  if (!user) {
    fail(
      `No account here for ${email}.\n  Run with --list to see which accounts this database actually has.`,
    );
  }

  const passwordHash = await hashPassword(password);

  // Checked before it is written, so a format drift between this script and
  // the server is caught here rather than at a sign-in that keeps refusing.
  if (!(await verifyPassword(password, passwordHash))) {
    fail("The hash this script produced does not verify. Refusing to write it.");
  }

  await pool.query(
    "UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
    [passwordHash, user.id],
  );

  console.log(`\n  Password set for ${user.email}.`);
  if (user.google_id) {
    console.log("  This account also still signs in with Google.");
  }
  console.log("  Signing out everywhere is not done here — existing sessions stay valid.\n");
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    await list();
    return;
  }

  const email = arg("email");
  const password = arg("password");

  if (!email || !password) {
    console.log(`
  Look at the accounts in this database, or set a password on one.

    --list                              show every account and how it signs in
    --email <address> --password <pw>   set a password on an existing account

  The password is visible in your shell history. Change it from the account
  page once you are back in.
`);
    process.exit(1);
  }

  await setPassword(email, password);
}

main()
  .catch((error: unknown) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(() => pool.end());
