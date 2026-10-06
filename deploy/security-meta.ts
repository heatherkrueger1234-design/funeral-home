/**
 * The two security headers a page can carry for itself, written into each
 * app's built index.html from the file nginx sends them from.
 *
 * Behind this repository's nginx every response carries
 * security-headers.conf. Not every host puts it there: Replit's static
 * hosting, which serves both live deployments, sends no security headers at
 * all, and appends its analytics script to the end of every page it serves --
 * which reports each page's address to Replit, and a family's address is
 * /f/<token>, their credential. Two of the headers can be said in the HTML
 * itself, and so hold wherever the page is served from:
 *
 *   - the Content-Security-Policy, as <meta http-equiv>. On Replit it is what
 *     refuses that script (https://i.replit.com/script.js).
 *   - the referrer policy, as <meta name="referrer">, so that the token in
 *     /f/<token>, or in /reset-password?token= and /verify-email?token=, is
 *     never sent as the Referer of the page's own requests -- its scripts,
 *     fonts and calls to the API -- into whatever logs those pass through.
 *
 * Read from security-headers.conf rather than written out a second time, so
 * there is one policy: change it there and the next build of each app carries
 * the change. The comments on why each part of the policy is what it is live
 * there too. `frame-ancestors` is left out because a browser ignores it in a
 * meta tag (and says so in the console); the header keeps it, as it keeps
 * X-Frame-Options, which no meta tag can stand in for.
 *
 * Behind nginx a page then carries both, and both are enforced -- two
 * policies are intersected, not one chosen -- which is safe because they are
 * the same policy, read from the same file in the same image build.
 *
 * Production builds only. The dev server injects inline scripts for hot
 * reloading and its error overlay, which `script-src 'self'` would refuse.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const HEADERS_FILE = path.resolve(import.meta.dirname, "security-headers.conf");

type PagePolicy = {
  contentSecurityPolicy: string;
  referrer: string;
};

/** One `add_header` value from the file, which must set it exactly once. */
function header(conf: string, name: string): string {
  const found = [
    ...conf.matchAll(
      new RegExp(
        `^add_header\\s+${name}\\s+(?:"([^"]*)"|(\\S+))\\s+always;`,
        "gm",
      ),
    ),
  ];
  if (found.length !== 1) {
    // A build that quietly shipped no policy, or the wrong one of two, would
    // look exactly like a build that shipped the right one.
    throw new Error(
      `deploy/security-headers.conf should set ${name} exactly once, and sets ` +
        `it ${found.length} times. The apps' index.html takes it from there.`,
    );
  }
  return found[0]![1] ?? found[0]![2]!;
}

function pagePolicy(
  conf: string = readFileSync(HEADERS_FILE, "utf8"),
): PagePolicy {
  const contentSecurityPolicy = header(conf, "Content-Security-Policy")
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^frame-ancestors\b/i.test(directive))
    .join("; ");
  return { contentSecurityPolicy, referrer: header(conf, "Referrer-Policy") };
}

function attribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/**
 * The page with the policy straight after its <meta charset>: before every
 * script, stylesheet and preload, since a meta policy governs only what comes
 * after it.
 */
function withPagePolicy(
  html: string,
  policy: PagePolicy = pagePolicy(),
): string {
  const charset = /^([ \t]*)<meta\s+charset=["']?[\w-]+["']?\s*\/?>/im.exec(
    html,
  );
  if (!charset) {
    throw new Error(
      "index.html has no <meta charset>, which the security policy is written after.",
    );
  }
  const indent = charset[1] ?? "";
  const end = charset.index + charset[0].length;
  return (
    html.slice(0, end) +
    `\n${indent}<meta http-equiv="Content-Security-Policy" content="${attribute(policy.contentSecurityPolicy)}" />` +
    `\n${indent}<meta name="referrer" content="${attribute(policy.referrer)}" />` +
    html.slice(end)
  );
}

/** The Vite plugin each app's vite.config.ts lists. */
export function securityMeta() {
  return {
    name: "security-meta",
    apply: "build" as const,
    transformIndexHtml: {
      order: "post" as const,
      handler: (html: string) => withPagePolicy(html),
    },
  };
}
