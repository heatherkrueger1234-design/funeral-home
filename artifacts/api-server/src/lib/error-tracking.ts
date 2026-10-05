import * as Sentry from "@sentry/node";
import type { ErrorEvent, NodeOptions } from "@sentry/node";
import { logger } from "./logger";

/**
 * Knowing when it breaks, without telling anyone who it broke for.
 *
 * LAUNCH.md said it plainly: "When it breaks at 2am before an 11am funeral,
 * we find out from the director." Errors go to Sentry when `SENTRY_DSN` is
 * set, and nowhere but the log when it is not -- the same posture as mail.
 *
 * What is sent is deliberately thin, because this product holds social
 * security numbers, causes of death and photographs of the dead, and an
 * error tracker is a third party that the DPA would have to name:
 *
 *  - No request bodies, cookies, headers, query strings or user records.
 *    Every `dataCollection` category is off and `beforeSend` removes the
 *    request outright;
 *    what replaces it is the route *pattern* ("/api/cases/:caseId"), never
 *    a URL, because a family's URL is their credential.
 *  - No breadcrumbs. They are a running log of URLs and console lines, which
 *    is exactly where a family token or a name would leak.
 *  - No automatic instrumentation of Express or HTTP. Only the integrations
 *    that catch a crash are installed.
 *  - Every message and exception value is passed through `scrubText`, which
 *    takes out email addresses, link tokens, nine-digit numbers and phone
 *    numbers -- the shapes a Postgres "duplicate key" message carries.
 *
 * If this is ever widened, the DPA's list of sub-processors widens with it.
 */

let enabled = false;

export function isErrorTrackingEnabled(): boolean {
  return enabled;
}

/**
 * Called once, first thing at startup. Returns whether it is on.
 *
 * `transport` is for the tests, which read what would have been sent rather
 * than trusting that the scrubbing is wired in.
 */
export function initErrorTracking(
  options: { transport?: NodeOptions["transport"] } = {},
): boolean {
  const dsn = process.env["SENTRY_DSN"]?.trim();

  if (!dsn) {
    logger.warn(
      { component: "error-tracking" },
      'SENTRY_DSN is not set. Server errors are written to this log only, and nobody is told when they happen. See DEPLOY.md, "Knowing when it breaks".',
    );
    return false;
  }

  Sentry.init({
    dsn,
    environment:
      process.env["SENTRY_ENVIRONMENT"]?.trim() ||
      process.env["NODE_ENV"] ||
      "production",
    release: process.env["SENTRY_RELEASE"]?.trim() || undefined,
    // Every category of collected data, off by name rather than by default:
    // a default that changes in the next major version must not quietly
    // start sending cookies from a family's request.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    // Crashes, not performance: nothing here records a request's timing,
    // which is also nothing that records a request.
    tracesSampleRate: 0,
    defaultIntegrations: false,
    enableRuntimeChannelInjection: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event),
    ...(options.transport ? { transport: options.transport } : {}),
  });

  enabled = true;
  logger.info({ component: "error-tracking" }, "Error tracking is on");
  return true;
}

/* ------------------------------------------------------------ scrubbing -- */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** "Bearer abc…", wherever it turns up. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
/**
 * A family link token, a session id, a reset token: long runs of base64url.
 * Thirty-two characters is shorter than any token this product mints and
 * longer than any word or identifier a stack trace contains.
 */
const TOKEN = /[A-Za-z0-9_-]{32,}/g;
/** An SSN, with or without its dashes, and any other nine-digit run. */
const NINE_DIGITS = /\b\d{3}-?\d{2}-?\d{4}\b/g;
/** A US phone number in the ways people type one. */
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g;

/** Take the personal shapes out of a piece of text. */
export function scrubText(text: string): string {
  return text
    .replace(BEARER, "Bearer [token]")
    .replace(EMAIL, "[email]")
    .replace(TOKEN, "[token]")
    .replace(PHONE, "[phone]")
    .replace(NINE_DIGITS, "[number]");
}

/**
 * A path as it may be reported: no query string, no fragment, a family
 * link's token replaced, and numeric ids kept (they name a row, not a person,
 * and "case 412" is what makes an error reproducible).
 */
export function scrubPath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return scrubText(
    bare.replace(/\/(f|reset-password|verify-email)\/[^/]+/g, "/$1/[token]"),
  );
}

/** The event as it may leave this process, or as close to it as possible. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;

  if (event.message) event.message = scrubText(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }

  return event;
}

/* ------------------------------------------------------------- reporting -- */

export type ErrorSource = "api" | "family" | "console" | "admin";

/**
 * Send one error, with the little context that is safe to send.
 *
 * A no-op when tracking is off: callers do not have to know, and the log
 * line each caller already writes is the record either way.
 */
export function reportError(
  err: unknown,
  context: {
    source: ErrorSource;
    route?: string;
    method?: string;
    status?: number;
  },
): void {
  if (!enabled) return;

  Sentry.withScope((scope) => {
    scope.setTag("source", context.source);
    if (context.route) scope.setTag("route", scrubPath(context.route));
    if (context.method) scope.setTag("method", context.method);
    if (context.status) scope.setTag("status", String(context.status));
    Sentry.captureException(err);
  });
}

/** Flush before a deliberate exit, so the last error is not the one lost. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
