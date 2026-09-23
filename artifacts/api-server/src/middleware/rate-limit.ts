import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http";

type Bucket = { count: number; resetAt: number };

/**
 * A small fixed-window limiter held in process memory. It exists to blunt
 * credential stuffing against the auth endpoints, not to be a general traffic
 * shaper — a multi-instance deployment should move this to Redis or the
 * platform's own edge limiter.
 */
/** A limiter handler, plus the hook tests use to start from a clean slate. */
export type RateLimiter = RequestHandler & { reset: () => void };

export function rateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
}): RateLimiter {
  const {
    windowMs,
    max,
    message = "Too many attempts. Please wait a moment.",
  } = options;
  const buckets = new Map<string, Bucket>();

  // Buckets are only evicted on access, so a sweep keeps an idle process from
  // holding every IP that ever hit it.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  const handler: RequestHandler = (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("retry-after", String(retryAfter));
      next(new HttpError(429, message));
      return;
    }

    next();
  };

  return Object.assign(handler, { reset: () => buckets.clear() });
}

function clientKey(req: Request): string {
  // `req.ip` honours `trust proxy`, which app.ts sets from TRUST_PROXY_HOPS.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * Sign-in, registration, password change and account deletion.
 *
 * The window and ceiling are configurable because the right numbers depend on
 * the deployment — a shared corporate NAT and a single household look very
 * different from one address. The defaults are chosen for the latter, which
 * is what this application actually is.
 */
function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
}

/**
 * The family surface.
 *
 * Not about guessing tokens -- those are 32 random bytes and are not going to
 * be found by volume. It is about the fact that this is the one authenticated
 * surface reachable by anyone holding a forwarded text message, where every
 * write costs the home storage. Generous enough that a family uploading fifty
 * photographs on hotel wifi never sees it.
 */
const FAMILY_LIMIT_MESSAGE =
  "That was a lot at once. Please wait a moment and try again.";

const familyWrites = rateLimit({
  windowMs: 60_000,
  max: 240,
  message: FAMILY_LIMIT_MESSAGE,
});

/*
 * Reads are counted separately, and more generously.
 *
 * Every photograph in the bin is its own authenticated GET, because the
 * portal cannot put the token in an `<img src>` (see `AuthedImage`). With
 * one shared bucket a family who had sent 240 photographs could not open
 * the photographs page at all: the thumbnails alone spent the minute's
 * allowance, and the session, the thread and every save after them came back
 * 429. What this limiter is for is writes — each one costs the home storage —
 * so that is where the tight ceiling stays; reading a case's own pictures
 * back only has to be kept from being a flood.
 */
const familyReads = rateLimit({
  windowMs: 60_000,
  max: 1200,
  message: FAMILY_LIMIT_MESSAGE,
});

export const familyRateLimit: RateLimiter = Object.assign(
  ((req, res, next) =>
    req.method === "GET" || req.method === "HEAD"
      ? familyReads(req, res, next)
      : familyWrites(req, res, next)) as RequestHandler,
  {
    reset: () => {
      familyReads.reset();
      familyWrites.reset();
    },
  },
);

export const authRateLimit: RateLimiter = rateLimit({
  windowMs: positiveIntFromEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: positiveIntFromEnv("AUTH_RATE_LIMIT_MAX", 20),
});

/**
 * The public front door.
 *
 * Sized for a person, not a browser: someone loads the home's page, reads it,
 * fills in one form, and submits it once. Thirty requests a minute leaves room
 * for a re-read and a mistyped field, and none for a script.
 *
 * This is the first of two ceilings. It lives in process memory, so it does
 * not survive a restart and does not see a second instance; the hourly
 * ceilings counted in the database (see `routes/public.ts`) are what actually
 * protect a director's queue. This one is here to keep the cheap flood from
 * reaching the database at all.
 */
export const publicRateLimit: RateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message:
    "That was a lot at once. Please wait a moment — and if this cannot wait, " +
    "telephone the funeral home.",
});
