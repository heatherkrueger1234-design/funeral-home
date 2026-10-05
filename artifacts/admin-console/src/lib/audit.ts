import type { AuditEntry } from "@/lib/api";

/** Lines asked for at a time. The API gives at most 200 in one answer. */
export const AUDIT_PAGE_SIZE = 100;

export type AuditFilters = { homeId: number | null; action: string };

/**
 * The log's filters, read from the address -- which is where they live, so
 * a home's page can link straight to its own history and the link can be
 * sent to whoever asked.
 */
export function auditFilters(search: string): AuditFilters {
  const params = new URLSearchParams(search);
  // `?home=` is accepted as well as `?homeId=`, so a link written either way
  // -- the home's page has used both -- lands on the same filtered log.
  const homeId =
    Number(params.get("homeId")) || Number(params.get("home")) || null;
  const action = params.get("action") ?? "";
  return { homeId, action };
}

/**
 * The address with one filter changed. Choosing a home drops a `?home=` the
 * page arrived with, or "Every home" could never clear it.
 */
export function auditFilterHref(
  search: string,
  key: "homeId" | "action",
  value: string,
): string {
  const next = new URLSearchParams(search);
  if (key === "homeId") next.delete("home");
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return query ? `/audit?${query}` : "/audit";
}

/**
 * One page of the log, older than the line `before` when there is one. An id
 * rather than a page number, because the log grows at the top while somebody
 * is reading it.
 */
export function auditQuery(
  { homeId, action }: AuditFilters,
  before: number | null,
): string {
  const qs = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  if (homeId) qs.set("homeId", String(homeId));
  if (action) qs.set("action", action);
  if (before) qs.set("before", String(before));
  return qs.toString();
}

/**
 * Where "Load older entries" carries on from: the oldest line on the page.
 * A short page is the last one. Asking once more to find an empty page would
 * work too, but it is a button that does nothing when pressed.
 */
export function olderThan(page: readonly AuditEntry[]): number | null {
  return page.length < AUDIT_PAGE_SIZE
    ? null
    : (page[page.length - 1]?.id ?? null);
}

/**
 * The homes to filter by: the homes this log mentions, by name, not the
 * homes list. Fetching that list to fill a dropdown would itself be an
 * audited read -- the log growing a line because somebody opened the log.
 */
export function homesInLog(
  entries: readonly AuditEntry[],
  homeId: number | null,
): Array<[number, string]> {
  const seen = new Map<number, string>();
  for (const entry of entries) {
    if (entry.subjectHomeId !== null && !seen.has(entry.subjectHomeId)) {
      seen.set(
        entry.subjectHomeId,
        entry.subjectHomeName ?? `Home #${entry.subjectHomeId}`,
      );
    }
  }
  if (homeId !== null && !seen.has(homeId)) {
    seen.set(homeId, `Home #${homeId}`);
  }
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

/**
 * What a line with no home is about. Not "every home": a line with no home
 * is about the platform itself -- a group, the list of who has access, the
 * overview -- and saying "every home" read as though every customer had
 * been opened.
 */
export function platformSubject(action: string): string {
  return ACROSS_EVERY_HOME.has(action)
    ? "Every home"
    : action.startsWith("group.")
      ? "A group"
      : action.startsWith("platform.admin")
        ? "The access list"
        : "Platform";
}

/**
 * The actions whose missing home means "all of them" rather than "none":
 * listing the homes and the overview read across every customer at once.
 * Everything else with no home on it -- granting access, groups -- is about
 * no home, and calling those "Every home" on a page shown to an insurer
 * would describe a far larger read than happened.
 */
const ACROSS_EVERY_HOME: ReadonlySet<string> = new Set([
  "homes.list",
  "platform.overview",
]);
