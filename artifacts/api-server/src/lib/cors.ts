import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * The frontend and this API are served from one origin by the platform
 * router, so in the normal deployment no cross-origin request should be
 * allowed at all — and none needs to be.
 *
 * `CORS_ORIGINS` exists for the cases that genuinely differ (a separate dev
 * server, a future mobile build) and takes an explicit comma-separated
 * allowlist. There is deliberately no wildcard: credentials travel on these
 * requests, and `*` combined with cookies would let any site on the internet
 * read the signed-in user's journal.
 */
function configuredOrigins(): Set<string> {
  return new Set(
    (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

/**
 * Refuse a write that a browser says came from another origin.
 *
 * CORS only decides whether a page may *read* a response; it does not stop
 * the request being sent, and a plain HTML form can POST here with the
 * session cookie attached whenever the browser considers the two pages the
 * same *site*. SameSite=Lax covers a stranger's domain. It does not cover a
 * sibling hostname: the family portal, the console and the admin console are
 * three subdomains of one site by design, so anything that ever ran script on
 * the family portal -- the one front end reached by a forwarded text message
 * -- could have submitted a form to the console's API as the signed-in
 * director. The Origin header is set by the browser and cannot be forged by
 * the page, so a write carrying a foreign one is refused here.
 *
 * No Origin at all is let through: that is curl, the scheduler, Stripe's
 * webhook and the test suite, none of which carries a cookie a page could
 * have borrowed.
 */
export const rejectCrossOriginWrites: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }

  /*
   * The one write a third party is meant to make. RFC 8058's one-click
   * unsubscribe is POSTed by the recipient's mail provider, not by a page of
   * ours, and a provider that sends its own Origin would otherwise be refused
   * -- leaving a family who pressed "Unsubscribe" in Gmail still enrolled.
   * Forgery buys nothing here: the signed id in the query is the whole
   * authority, and the only thing it can do is stop mail.
   */
  if (req.path === "/public/aftercare/unsubscribe") {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    next(new HttpError(403, "That request came from somewhere we don't recognise."));
    return;
  }

  // `Host` is the browser's own, passed through unchanged by nginx and
  // Caddy (see deploy/nginx.conf.template).
  if (originHost === req.get("host") || configuredOrigins().has(origin)) {
    next();
    return;
  }

  next(new HttpError(403, "That request came from somewhere we don't recognise."));
};

export function corsOptions(): CorsOptions {
  const configured = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.includes("*")) {
    throw new Error(
      'CORS_ORIGINS must not contain "*": this API sends credentials, and a ' +
        "wildcard origin would expose every signed-in account's data to any site.",
    );
  }

  const allowed = new Set(configured);

  if (allowed.size > 0) {
    logger.info(
      { origins: [...allowed] },
      "Cross-origin requests allowed from configured origins",
    );
  }

  return {
    credentials: true,
    origin(origin, callback) {
      // No Origin header: same-origin navigations, curl, health probes.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }

      // Reject by withholding the header rather than erroring, so the browser
      // reports an ordinary CORS failure instead of this turning into a 500.
      callback(null, false);
    },
  };
}
