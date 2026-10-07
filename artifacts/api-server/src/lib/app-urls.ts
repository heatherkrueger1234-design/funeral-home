/**
 * Where the three front ends live, for a link that leaves this process.
 *
 * `CONSOLE_URL` and `FAMILY_PORTAL_URL` are the deployed origins of the
 * director console and the family portal. Each falls back to a relative
 * path rather than to a guessed hostname: a link that is obviously
 * incomplete is better than one that looks right and opens somebody else's
 * deployment. The one trailing slash an operator may have typed is dropped
 * so that `${origin}/reset-password` never reads `//reset-password`.
 */
function originFrom(name: "CONSOLE_URL" | "FAMILY_PORTAL_URL"): string {
  return process.env[name]?.replace(/\/+$/, "") ?? "";
}

/** A path on the director console, as an absolute URL. */
export function consoleUrl(path: string): string {
  return `${originFrom("CONSOLE_URL")}${path}`;
}

/** A path on the family portal, as an absolute URL. */
export function familyPortalUrl(path: string): string {
  return `${originFrom("FAMILY_PORTAL_URL")}${path}`;
}
