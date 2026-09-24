import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import {
  api,
  AUDIT_ACTION_LABELS,
  formatDateTime,
  type AuditEntry,
} from "@/lib/api";
import { Card, EmptyState, ErrorState, LoadingRows } from "@/components/ui";

/**
 * Every time anybody here looked across a tenant boundary.
 *
 * This page exists to be shown to a customer. A funeral home's insurer asks
 * what the software vendor can see about their families, and "almost nothing,
 * and here is the log of every time anyone looked" is an answer; "trust us"
 * is not. It is also how the person running the platform notices an odd
 * pattern of access, which nobody does if the log is only in the database.
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
  // `?home=12` narrows the log to one home: the question a customer actually
  // asks is "what have you looked at of ours", not "what have you looked at".
  const raw = new URLSearchParams(useSearch()).get("home");
  const homeId = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  const query = useQuery({
    queryKey: ["audit", homeId],
    queryFn: () =>
      api.get<AuditEntry[]>(
        `/admin/audit?limit=${LIMIT}` + (homeId ? `&homeId=${homeId}` : ""),
      ),
    // Opening a home writes a line here, so a log fifteen seconds stale is
    // missing the very visit that brought somebody to it.
    staleTime: 0,
  });

  const homeName =
    homeId && query.data
      ? (query.data.find((entry) => entry.subjectHomeName)?.subjectHomeName ??
        `home #${homeId}`)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl leading-tight">Access log</h1>
        <p className="mt-1 max-w-prose text-[var(--muted-foreground)]">
          Every read across a home's boundary, and every change made from this
          console. Nothing about a family or a decedent is recorded here — a
          log of who looked that collected the data it protects would be the
          same leak wearing a different hat.
        </p>
        {homeId && (
          <p className="mt-3 text-sm">
            Showing only what was done to {homeName ?? "one home"}. Listing
            every home is not included, because it names none of them.{" "}
            <Link href="/audit" className="underline">
              Show the whole log
            </Link>
          </p>
        )}
      </div>

      {query.isPending ? (
        <LoadingRows rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          detail={
            homeId
              ? "Nobody has opened or changed this home from the console yet."
              : "The first time anyone opens a home from this console, it will appear here."
          }
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="relative overflow-x-auto">
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
                {query.data.map((entry) => (
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
                        <span className="text-[var(--muted-foreground)]">
                          {ACROSS_EVERY_HOME.has(entry.action) ? "Every home" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.length === LIMIT && (
            <p className="border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
              The latest {LIMIT} entries. Older ones are kept, and are not
              shown here yet.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
