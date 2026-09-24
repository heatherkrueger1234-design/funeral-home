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
export function Audit() {
  usePageTitle("Access log");

  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const homeId = Number(params.get("homeId")) || null;
  const action = params.get("action") ?? "";

  const setFilter = (key: "homeId" | "action", value: string) => {
    const next = new URLSearchParams(search);
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
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-64">
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
        <div className="w-64">
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
              ? "Nothing in the log matches those filters."
              : "The first time anyone opens a home from this console, it will appear here."
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
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
                      <td className="px-4 py-3 text-sm break-all">
                        {entry.actorEmail}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                        {entry.detail && (
                          <span className="text-[var(--muted-foreground)]">
                            {" "}
                            — {entry.detail}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {entry.subjectHomeId ? (
                          <Link
                            href={`/homes/${entry.subjectHomeId}`}
                            className="no-underline hover:underline"
                          >
                            {entry.subjectHomeName ?? `#${entry.subjectHomeId}`}
                          </Link>
                        ) : (
                          // Not "every home": a line with no home is about
                          // the platform itself -- the overview, the list of
                          // who has access -- and saying "every home" read as
                          // though every customer had been opened.
                          <span className="text-[var(--muted-foreground)]">
                            Platform
                          </span>
                        )}
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
