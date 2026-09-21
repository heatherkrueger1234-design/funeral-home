import type { CorsOptions } from "cors";
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
