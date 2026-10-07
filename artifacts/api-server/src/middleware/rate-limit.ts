import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http";
import { tenant } from "./require-auth";

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
  /** What is counted: the caller's address unless something else is given. */
  key?: (req: Request) => string;
}): RateLimiter {
  const {
    windowMs,
    max,
    message = "Too many attempts. Please wait a moment.",
    key: keyOf = clientKey,
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
    const key = keyOf(req);
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
  return addressKey(req.ip ?? req.socket.remoteAddress ?? "unknown");
}

/**
 * What an address is counted as: itself for IPv4, its /64 for IPv6.
 *
 * Every IPv6 connection a household or a phone has comes with a /64 --
 * eighteen quintillion addresses, any of which the device can use -- so
 * counting by the whole address gave anybody with an ordinary home
 * connection a fresh bucket per request, and the sign-in limiter guarding
 * against password guessing guarded nothing. A /64 is one customer's line,
 * the unit a provider hands out, so it is also not too wide: two families
 * are not counted together because they share an ISP.
 */
export function addressKey(ip: string): string {
  const bare = ip.split("%")[0]!; // a zone id: fe80::1%eth0
  if (isIP(bare) !== 6) return ip;

  // An IPv4 client on a dual-stack socket arrives as ::ffff:a.b.c.d.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped) return mapped[1]!;

  // A dotted tail (64:ff9b::1.2.3.4) stands for the last two groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  const text = dotted
    ? bare.slice(0, dotted.index) +
      ((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16) +
      ":" +
      ((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16)
    : bare;

  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];

  return `${groups
    .slice(0, 4)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
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

/**
 * Crash reports from the browser.
 *
 * A screen that fails in a loop -- a render that throws on every retry --
 * would otherwise send a report per frame. Twenty a minute from one address
 * is more than any person meets, and keeps one broken tab from filling the
 * log or the error tracker's quota.
 */
export const clientErrorRateLimit: RateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: "Too many reports at once.",
});

/**
 * A suggested obituary, per home rather than per address.
 *
 * Each one is paid for by the platform, by the token, and anybody can
 * register a home: twenty an hour is generous for a director redrafting a
 * few obituaries and useless for running up a bill. Counted per home so a
 * home's staff share it, and one home's use never spends another's. Only
 * mounted behind sign-in (`routes/obituary.ts`), where `tenant` is set.
 */
export const suggestionRateLimit: RateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  key: (req) => `home:${tenant(req).id}`,
  message:
    "That is a lot of suggestions for one hour. The composed draft is unchanged; try again later.",
});

/**
 * The downloads that cost the most to make, per home and per hour.
 *
 * A case export and a photo pack each decrypt and zip every photograph on
 * the case, and the CSV walks every case the home has: a few seconds of a
 * thread and a few hundred megabytes each, and nothing in the family or
 * sign-in limiters touches them because they are reached with a staff
 * session. One home asking for them in a loop -- a script, or a stuck
 * retry -- would have every other home's morning slow to a crawl. Twenty
 * exports an hour is more than any home leaving the product needs; thirty
 * spreadsheets is more than anybody reconciling against their case system
 * does. Per home so that one home's use never spends another's, and so
 * that the ceiling is reached by the account, not dodged by the address.
 * Only mounted behind sign-in, where `tenant` is set.
 */
function perHomeHourly(max: number, message: string): RateLimiter {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max,
    key: (req) => `home:${tenant(req).id}`,
    message,
  });
}

export const caseExportRateLimit: RateLimiter = perHomeHourly(
  20,
  "That is a lot of exports for one hour. The case is unchanged; try again later.",
);

export const photoPackRateLimit: RateLimiter = perHomeHourly(
  20,
  "That is a lot of photo packs for one hour. The photographs are unchanged; try again later.",
);

export const caseListExportRateLimit: RateLimiter = perHomeHourly(
  30,
  "That is a lot of spreadsheets for one hour. Try again later.",
);
