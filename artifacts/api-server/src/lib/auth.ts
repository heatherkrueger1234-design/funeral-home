import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { CookieOptions, Response } from "express";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  db,
  passwordResetsTable,
  sessionsTable,
  usersTable,
  type User,
} from "@workspace/db";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

// OWASP's floor for scrypt at the time of writing. Kept in the stored hash
// string so these can be raised later without invalidating existing passwords.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Long enough to act on after finding the email; short enough to matter. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export const SESSION_COOKIE = "fh_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Minimum that still lets people use a passphrase they will actually recall. */
export const MIN_PASSWORD_LENGTH = 10;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const options = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!Object.values(options).every(Number.isInteger)) return false;

  const expected = Buffer.from(rawHash, "base64");
  const derived = await scrypt(
    password,
    Buffer.from(rawSalt, "base64"),
    expected.length,
    options,
  );

  // Lengths must match before timingSafeEqual, which throws otherwise.
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

/**
 * Burn a comparable amount of CPU when no account matched, so that response
 * timing does not reveal which email addresses are registered.
 */
const DUMMY_HASH_PROMISE = hashPassword("password-that-is-never-valid");
export async function fakeVerify(password: string): Promise<void> {
  await verifyPassword(password, await DUMMY_HASH_PROMISE);
}

/** Sessions are looked up by digest, so the raw token is never at rest. */
function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessionsTable).values({
    tokenHash: digest(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function resolveSession(token: string): Promise<User | undefined> {
  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(
      and(
        eq(sessionsTable.tokenHash, digest(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row?.user;
}

export async function destroySession(token: string): Promise<void> {
  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.tokenHash, digest(token)));
}

/** Used when a password changes: every other device is signed out. */
export async function destroyAllSessions(userId: number): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
}

/* --------------------------------------------------------- password resets */

/**
 * Issues a single-use reset token. Only the digest is stored, so the working
 * value exists in exactly one place: the email that was just sent.
 */
export async function createPasswordReset(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await db.insert(passwordResetsTable).values({
    tokenHash: digest(token),
    userId,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });

  return token;
}

/**
 * Returns the account a token belongs to, or undefined when the token is
 * unknown, expired, or already spent. Callers must not distinguish between
 * those cases in what they return to the client.
 */
export async function consumePasswordReset(
  token: string,
): Promise<User | undefined> {
  const tokenHash = digest(token);

  const [row] = await db
    .select({ user: usersTable })
    .from(passwordResetsTable)
    .innerJoin(usersTable, eq(usersTable.id, passwordResetsTable.userId))
    .where(
      and(
        eq(passwordResetsTable.tokenHash, tokenHash),
        gt(passwordResetsTable.expiresAt, new Date()),
        isNull(passwordResetsTable.usedAt),
      ),
    )
    .limit(1);

  if (!row) return undefined;

  // Marked spent in the same request that redeems it, so the link cannot be
  // replayed out of an email that stays in an inbox forever.
  const marked = await db
    .update(passwordResetsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetsTable.tokenHash, tokenHash),
        isNull(passwordResetsTable.usedAt),
      ),
    )
    .returning({ tokenHash: passwordResetsTable.tokenHash });

  // Lost the race against a concurrent redemption of the same token.
  if (marked.length === 0) return undefined;

  return row.user;
}

/** Any other outstanding links are void once one has been used. */
export async function revokePasswordResets(userId: number): Promise<void> {
  await db
    .update(passwordResetsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetsTable.userId, userId),
        isNull(passwordResetsTable.usedAt),
      ),
    );
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
