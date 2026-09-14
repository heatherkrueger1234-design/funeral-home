import { randomBytes, createHash } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  platformAuditTable,
  platformSessionsTable,
  type PlatformAdmin,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Sessions for the platform account — us, not a funeral home.
 *
 * Everything here is deliberately parallel to `auth.ts` rather than shared
 * with it: a different table, a different cookie, a different resolver. The
 * password hashing *is* shared, because there should only ever be one of
 * those in a codebase, and it is imported rather than reimplemented.
 *
 * What must never exist is a code path where a staff session resolves to a
 * platform admin, or the reverse. Keeping the two resolvers apart is what
 * guarantees that, and it survives somebody later editing either one without
 * reading this comment.
 */

/** A different name from `fh_session`, so the two can never be confused. */
export const PLATFORM_SESSION_COOKIE = "fh_platform";

/**
 * Much shorter than a director's thirty days. This account can read across
 * every funeral home in the system; a laptop left open in a coffee shop
 * should stop being a problem the same day rather than the same month.
 */
export const PLATFORM_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPlatformSession(adminId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(platformSessionsTable).values({
    tokenHash: digest(token),
    adminId,
    expiresAt: new Date(Date.now() + PLATFORM_SESSION_TTL_MS),
  });
  return token;
}

export async function resolvePlatformSession(
  token: string,
): Promise<PlatformAdmin | undefined> {
  const [row] = await db
    .select({ admin: platformAdminsTable })
    .from(platformSessionsTable)
    .innerJoin(
      platformAdminsTable,
      eq(platformAdminsTable.id, platformSessionsTable.adminId),
    )
    .where(
      and(
        eq(platformSessionsTable.tokenHash, digest(token)),
        gt(platformSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row?.admin;
}

export async function destroyPlatformSession(token: string): Promise<void> {
  await db
    .delete(platformSessionsTable)
    .where(eq(platformSessionsTable.tokenHash, digest(token)));
}

/** Used when a password changes: every other device is signed out. */
export async function destroyAllPlatformSessions(adminId: number): Promise<void> {
  await db
    .delete(platformSessionsTable)
    .where(eq(platformSessionsTable.adminId, adminId));
}

export async function purgeExpiredPlatformSessions(): Promise<void> {
  await db
    .delete(platformSessionsTable)
    .where(lt(platformSessionsTable.expiresAt, new Date()));
}

/* ----------------------------------------------------------------- audit -- */

/**
 * Record that one of us looked at something.
 *
 * Append-only, and never carries the data that was looked at — only enough to
 * say what was reached. A funeral home's insurer is entitled to ask what the
 * vendor can see, and a log of every look is a better answer than a promise.
 *
 * Fire-and-forget on purpose: failing to write an audit row must not fail the
 * request, or the first database hiccup takes the console down. A warning in
 * the log is the right trade, and it is loud enough to notice.
 */
export function recordPlatformAccess(options: {
  adminId: number;
  action: string;
  funeralHomeId?: number | null;
  subject?: string | null;
}): void {
  void db
    .insert(platformAuditTable)
    .values({
      adminId: options.adminId,
      action: options.action,
      funeralHomeId: options.funeralHomeId ?? null,
      subject: options.subject ?? null,
    })
    .catch((err: unknown) => {
      logger.warn({ err, action: options.action }, "Could not record platform access");
    });
}

/* ---------------------------------------------------------------- cookie -- */

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Stricter than the staff cookie. Nothing legitimately navigates into the
    // admin console from another site, so there is no cross-site flow to keep
    // working and no reason to accept one.
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function setPlatformSessionCookie(
  req: Request,
  res: Response,
  token: string,
): void {
  if (cookieOptions().secure && !req.secure) {
    logger.warn(
      { host: req.get("host") ?? null },
      "Issued a Secure platform cookie over a connection this server sees as " +
        "plain HTTP. The browser will accept it and never send it back, so " +
        "sign-in will appear to silently fail. Terminate TLS in front of this " +
        "server and make sure the proxy sets X-Forwarded-Proto.",
    );
  }

  res.cookie(PLATFORM_SESSION_COOKIE, token, {
    ...cookieOptions(),
    maxAge: PLATFORM_SESSION_TTL_MS,
  });
}

export function clearPlatformSessionCookie(res: Response): void {
  res.clearCookie(PLATFORM_SESSION_COOKIE, cookieOptions());
}
