import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { CookieOptions, Request, Response } from "express";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  db,
  emailVerificationsTable,
  passwordResetsTable,
  sessionsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { logger } from "./logger";

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

/**
 * Much longer than a password reset, and for a different reason.
 *
 * A reset is short because someone may be trying to take an account. This one
 * is a confirmation, and the person is a funeral director who registered at
 * four in the afternoon and did not open their inbox until the following
 * week — because in between, somebody died. An hour here would mean a
 * director who finally clicks the link is told it has expired, on a screen
 * they reached while doing exactly what they bought this for.
 */
export const EMAIL_VERIFICATION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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

/* ---------------------------------------------------- email verification -- */

/**
 * Issues a single-use verification token, for the address as it stands now.
 *
 * The address is written into the row rather than read back off the user at
 * redemption: a director who typed `.con`, corrected it to `.com` and then
 * clicked the link in the first email must not end up with the typo marked
 * verified. See `consumeEmailVerification`.
 */
export async function createEmailVerification(
  userId: number,
  email: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  await db.insert(emailVerificationsTable).values({
    tokenHash: digest(token),
    userId,
    email: normaliseEmail(email),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
  });

  return token;
}

/**
 * Redeems a verification token and marks the account verified.
 *
 * Returns the account, or undefined when the token is unknown, expired, spent,
 * or was issued for an address the account no longer uses. Callers must not
 * distinguish between those in what they tell the client — and the last of
 * them is the point of storing the address: a stale link proves somebody once
 * controlled an address that is no longer on this account, which is not the
 * thing being asked.
 */
export async function consumeEmailVerification(
  token: string,
): Promise<User | undefined> {
  const tokenHash = digest(token);

  const [row] = await db
    .select({ user: usersTable, email: emailVerificationsTable.email })
    .from(emailVerificationsTable)
    .innerJoin(usersTable, eq(usersTable.id, emailVerificationsTable.userId))
    .where(
      and(
        eq(emailVerificationsTable.tokenHash, tokenHash),
        gt(emailVerificationsTable.expiresAt, new Date()),
        isNull(emailVerificationsTable.usedAt),
      ),
    )
    .limit(1);

  if (!row) return undefined;
  if (row.email !== normaliseEmail(row.user.email)) return undefined;

  const marked = await db
    .update(emailVerificationsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailVerificationsTable.tokenHash, tokenHash),
        isNull(emailVerificationsTable.usedAt),
      ),
    )
    .returning({ tokenHash: emailVerificationsTable.tokenHash });

  // Lost the race against a concurrent redemption of the same token.
  if (marked.length === 0) return undefined;

  const [updated] = await db
    .update(usersTable)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(usersTable.id, row.user.id))
    .returning();

  return updated ?? row.user;
}

/**
 * Void any outstanding verification links for this account.
 *
 * Called when the address changes, because a link issued for the old one
 * would otherwise still be redeemable — and, per the check above, would fail
 * confusingly rather than harmlessly.
 */
export async function revokeEmailVerifications(userId: number): Promise<void> {
  await db
    .update(emailVerificationsTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailVerificationsTable.userId, userId),
        isNull(emailVerificationsTable.usedAt),
      ),
    );
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

/**
 * Say so, loudly, when the cookie we just issued cannot come back.
 *
 * In production the session cookie is always marked Secure — this holds
 * death certificates and social security numbers, and handing out a cookie
 * that will also travel over plain HTTP is not a trade worth making. But a
 * Secure cookie issued over plain HTTP is one the browser accepts and then
 * never sends, so the director signs in, lands back on the sign-in page, and
 * there is nothing in the log to say why.
 *
 * `req.secure` reads X-Forwarded-Proto from the proxies app.ts trusts. So
 * this fires for three mistakes: no TLS in front of the deployment, a reverse
 * proxy that is not forwarding the header, or TRUST_PROXY_HOPS set lower than
 * the number of proxies actually in front.
 */
function warnIfCookieCannotReturn(req: Request, res: Response): void {
  if (!cookieOptions().secure || req.secure) return;

  logger.warn(
    {
      forwardedProto: req.get("x-forwarded-proto") ?? null,
      host: req.get("host") ?? null,
    },
    "Issued a Secure session cookie over a connection this server sees as " +
      "plain HTTP, so the browser will accept it and never send it back — " +
      "sign-in will appear to silently fail. Terminate TLS in front of this " +
      "server, and make sure the reverse proxy sets X-Forwarded-Proto.",
  );
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  warnIfCookieCannotReturn(req, res);

  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
