import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  api,
  AUDIT_ACTION_LABELS,
  formatDateTime,
  type AuditEntry,
} from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingRows,
  Select,
  usePageTitle,
} from "@/components/ui";

const PAGE_SIZE = 100;

/**
 * Every time anybody here looked across a tenant boundary.
 *
 * This page exists to be shown to a customer. A funeral home's insurer asks
 * what the software vendor can see about their families, and "almost nothing,
 * and here is the log of every time anyone looked" is an answer; "trust us"
 * is not. It is also how the person running the platform notices an odd
 * pattern of access, which nobody does if the log is only in the database.
 *
 * It used to show the newest hundred lines and nothing else, so "who looked
 * at Horan & McConaty in March" had no answer on screen. Now it pages back as
 * far as the log goes, and narrows to one home or one kind of action. The
 * filters live in the address, so a home's page can link straight to its own
 * history and the link can be sent to whoever asked.
 */
const LIMIT = 100;

/**
 * The actions whose missing home means "all of them" rather than "none". The
 * rest -- granting access, groups -- are about no home, and used to be
 * labelled "Every home" as well, which on a page shown to an insurer reads as
 * a far larger read than it was.
 */
const ACROSS_EVERY_HOME = new Set(["homes.list", "platform.overview"]);

export function Audit() {
  usePageTitle("Access log");

  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  // `?home=` is accepted as well as `?homeId=`, so a link written either way
  // -- the home's page has used both -- lands on the same filtered log.
  const homeId =
    Number(params.get("homeId")) || Number(params.get("home")) || null;
  const action = params.get("action") ?? "";

  const setFilter = (key: "homeId" | "action", value: string) => {
    const next = new URLSearchParams(search);
    if (key === "homeId") next.delete("home");
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    navigate(query ? `/audit?${query}` : "/audit", { replace: true });
  };

  const query = useInfiniteQuery({
    queryKey: ["audit", { homeId, action }],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (homeId) qs.set("homeId", String(homeId));
      if (action) qs.set("action", action);
      if (pageParam) qs.set("before", String(pageParam));
      return api.get<AuditEntry[]>(`/admin/audit?${qs.toString()}`);
    },
    // A short page is the last one. Asking once more to find an empty page
    // would work too, but it is a button that does nothing when pressed.
    getNextPageParam: (last) =>
      last.length < PAGE_SIZE ? null : (last[last.length - 1]?.id ?? null),
  });

  const entries = useMemo(
    () => query.data?.pages.flat() ?? [],
    [query.data],
  );

  /*
   * The homes to filter by are the homes this log mentions, not the homes
   * list. Fetching that list to fill a dropdown would itself be an audited
   * read -- the log growing a line because somebody opened the log.
   */
  const homes = useMemo(() => {
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
  }, [entries, homeId]);

  const filtered = homeId !== null || action !== "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl leading-tight">Access log</h1>
        <p className="mt-1 max-w-prose text-[var(--muted-foreground)]">
          Every read across a home's boundary, and every change made from this
          console. Nothing about a family or a decedent is recorded here — a
          log of who looked that collected the data it protects would be the
          same leak wearing a different hat. The same person looking at the
          same thing again within five minutes is one line.
        </p>
        {homeId && (
          <p className="mt-3 text-sm">
            Showing only what was done to {homes.find(([id]) => id === homeId)?.[1] ?? "one home"}. Listing
            every home is not included, because it names none of them.{" "}
            <Link href="/audit" className="underline">
              Show the whole log
            </Link>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-full max-w-xs">
          <Select
            label="Home"
            value={homeId === null ? "" : String(homeId)}
            onChange={(event) => setFilter("homeId", event.target.value)}
          >
            <option value="">Every home, and the platform</option>
            {homes.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full max-w-xs">
          <Select
            label="What"
            value={action}
            onChange={(event) => setFilter("action", event.target.value)}
          >
            <option value="">Anything</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {filtered && (
          <Button variant="plain" onClick={() => navigate("/audit", { replace: true })}>
            Clear the filters
          </Button>
        )}
      </div>

      {query.isPending ? (
        <LoadingRows rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          title={filtered ? "Nothing matches that" : "Nothing logged yet"}
          detail={
            filtered
              ? "Nobody has done that yet, or not to this home."
              : "The first time anyone opens a home from this console, it will appear here."
          }
          action={
            filtered ? (
              <Button onClick={() => navigate("/audit", { replace: true })}>
                Show everything
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            {/* A phone gets the same entries as sentences; four columns of a
                log do not fit 390 pixels, and a sideways-scrolling table hid
                the "what", which is the column that matters. */}
            <ul className="divide-y divide-[var(--border)] md:hidden">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                  <What entry={entry} />
                  <Subject entry={entry} />
                  <span className="text-[var(--muted-foreground)] break-words">
                    {formatDateTime(entry.createdAt)} ·{" "}
                    {entry.actorEmail.replace("@", "​@")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[46rem] text-left">
                <thead>
                  <tr className="border-b border-[var(--border-strong)] bg-[var(--sunken)]">
                    <th scope="col" className="eyebrow px-4 py-2.5">When</th>
                    <th scope="col" className="eyebrow px-4 py-2.5">Who</th>
                    <th scope="col" className="eyebrow px-4 py-2.5">What</th>
                    <th scope="col" className="eyebrow px-4 py-2.5">Home</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-[var(--border)] transition-colors duration-150 last:border-0 hover:bg-[var(--sunken)]"
                    >
                      <td className="tabular px-4 py-3 text-sm whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm break-words">
                        {/* Allowed to wrap at the @ and nowhere else, rather
                            than mid-word wherever the column happens to end. */}
                        {entry.actorEmail.replace("@", "​@")}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <What entry={entry} />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Subject entry={entry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {query.hasNextPage ? (
            <div>
              <Button
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load older entries"}
              </Button>
              {query.isFetchNextPageError && (
                <p role="alert" className="mt-2 text-sm text-[var(--notice)]">
                  The older entries didn't load. Please try again.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">
              That is the beginning of the log.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function What({ entry }: { entry: AuditEntry }) {
  return (
    <span>
      {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
      {entry.detail && (
        <span className="text-[var(--muted-foreground)]"> — {entry.detail}</span>
      )}
    </span>
  );
}

function Subject({ entry }: { entry: AuditEntry }) {
  if (entry.subjectHomeId) {
    return (
      <Link
        href={`/homes/${entry.subjectHomeId}`}
        className="no-underline hover:underline"
      >
        {entry.subjectHomeName ?? `#${entry.subjectHomeId}`}
      </Link>
    );
  }

  // Not "every home": a line with no home is about the platform itself --
  // a group, the list of who has access, the overview -- and saying "every
  // home" read as though every customer had been opened.
  return (
    <span className="text-[var(--muted-foreground)]">
      {entry.action.startsWith("group.")
        ? "A group"
        : entry.action.startsWith("platform.admin")
          ? "The access list"
          : "Platform"}
    </span>
  );
}
