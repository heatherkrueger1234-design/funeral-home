/**
 * Telling us when a screen breaks, from the browser.
 *
 * Reports go to this app's own API (`POST /api/client-errors`), never to a
 * third party directly: the CSP keeps `connect-src` to this origin, and a
 * family's IP address stays off a vendor's servers -- the same reason the
 * fonts are self-hosted. The server scrubs and forwards them; see
 * `artifacts/api-server/src/lib/error-tracking.ts`.
 *
 * Reporting must never be the thing that breaks a page, so every step is
 * wrapped, and a broken tab cannot flood: one report per distinct message,
 * at most a handful per page load.
 */

type App = "family" | "console" | "admin";
type Kind = "render" | "error" | "rejection";

const MAX_REPORTS_PER_PAGE = 5;
const seen = new Set<string>();
let sent = 0;

/**
 * Noise from outside this app: a browser extension's scripts, and a layout
 * warning Chrome raises as an error although nothing is wrong.
 */
function isNoise(error: Error): boolean {
  return (
    /ResizeObserver loop/.test(error.message) ||
    /(chrome|moz|safari)-extension:\/\//.test(error.stack ?? "")
  );
}

/** The page's path, with any link token taken out before it leaves. */
export function reportablePath(pathname: string): string {
  return pathname.replace(
    /\/(f|reset-password|verify-email)\/[^/]+/g,
    "/$1/[token]",
  );
}

export function reportCrash(app: App, kind: Kind, cause: unknown): void {
  try {
    const error =
      cause instanceof Error
        ? cause
        : new Error(typeof cause === "string" ? cause : "Unknown error");
    if (isNoise(error)) return;

    const message = (error.message || error.name || "Unknown error").slice(
      0,
      1000,
    );
    const key = `${kind}:${message}`;
    if (seen.has(key) || sent >= MAX_REPORTS_PER_PAGE) return;
    seen.add(key);
    sent += 1;

    void fetch("/api/client-errors", {
      method: "POST",
      keepalive: true,
      // Nobody's session goes with a crash report.
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app,
        kind,
        message,
        stack: error.stack?.slice(0, 8000) ?? null,
        path: reportablePath(window.location.pathname).slice(0, 500),
      }),
    }).catch(() => undefined);
  } catch {
    // Nothing to do: the page is already in trouble.
  }
}

/** Uncaught errors and promises, for the whole page. Called once, at startup. */
export function installCrashReporting(app: App): void {
  window.addEventListener("error", (event) =>
    reportCrash(app, "error", event.error ?? event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    reportCrash(app, "rejection", event.reason),
  );
}
