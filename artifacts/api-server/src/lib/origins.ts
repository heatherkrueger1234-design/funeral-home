/**
 * Where the other two apps live, as the API was told at start.
 *
 * Every link this server writes into a text or an email — a family's link,
 * a password reset, an invitation, the public page a home pastes onto its
 * own website — is built from one of these two origins. They are the one
 * place that knowledge lives: the front ends ask for the finished address
 * rather than carrying a copy that can drift from it.
 */

const trim = (value: string | undefined) =>
  (value ?? "").trim().replace(/\/+$/, "");

/** The family portal's origin, e.g. https://continuumaftercare.com/family. */
export function familyPortalOrigin(): string {
  return trim(process.env["FAMILY_PORTAL_URL"]);
}

/** The director console's origin, e.g. https://continuumaftercare.com. */
export function consoleOrigin(): string {
  return trim(process.env["CONSOLE_URL"]);
}

/**
 * The address a home puts on its own website, or null when this deployment
 * has not been told where the portal is: a relative path pasted onto another
 * site points at that site, so no address is better than a wrong one.
 */
export function publicPageUrl(slug: string): string | null {
  const origin = familyPortalOrigin();
  return origin ? `${origin}/start/${slug}` : null;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * In production, refuse to start without both origins as absolute URLs.
 *
 * A relative link is a quiet failure: the API answers, the console works,
 * and the text a bereaved family receives reads "/f/..." and opens nothing.
 * Refusing at boot is the same reasoning as the encryption key — a loud
 * failure on the first start, not a silent one on the first family.
 * Development and tests are exempt so a local run needs no DNS.
 */
export function assertLinkOriginsConfigured(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env["NODE_ENV"] !== "production") return;

  const problems: string[] = [];
  for (const name of ["FAMILY_PORTAL_URL", "CONSOLE_URL"] as const) {
    const value = trim(env[name]);
    if (!value) problems.push(`${name} is not set`);
    else if (!isAbsoluteHttpUrl(value))
      problems.push(`${name} is "${value}", not an absolute http(s) URL`);
  }

  if (problems.length > 0) {
    throw new Error(
      `${problems.join("; ")}. Every link this server texts or emails is ` +
        "built from these, and a relative link opens nothing. Set both, " +
        "with the scheme and no trailing slash (see .env.example).",
    );
  }
}
