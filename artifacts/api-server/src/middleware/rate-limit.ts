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
  // `req.ip` honours `trust proxy`, which app.ts sets for the Replit router.
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
export const familyRateLimit: RateLimiter = rateLimit({
  windowMs: 60_000,
  max: 240,
  message: "That was a lot at once. Please wait a moment and try again.",
});

export const authRateLimit: RateLimiter = rateLimit({
  windowMs: positiveIntFromEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  max: positiveIntFromEnv("AUTH_RATE_LIMIT_MAX", 20),
});
