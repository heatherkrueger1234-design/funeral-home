import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
export function Audit() {
  const query = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<AuditEntry[]>("/admin/audit?limit=100"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl">Access log</h1>
        <p className="mt-1 max-w-prose text-[var(--muted-foreground)]">
          Every read across a home's boundary, and every change made from this
          console. Nothing about a family or a decedent is recorded here — a
          log of who looked that collected the data it protects would be the
          same leak wearing a different hat.
        </p>
      </div>

      {query.isPending ? (
        <LoadingRows rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          detail="The first time anyone opens a home from this console, it will appear here."
        />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left">
              <thead className="text-sm text-[var(--muted-foreground)]">
                <tr className="border-b border-[var(--border)]">
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Who</th>
                  <th scope="col" className="px-4 py-3 font-medium">What</th>
                  <th scope="col" className="px-4 py-3 font-medium">Home</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-[var(--border)] last:border-0"
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
                          className="hover:underline"
                        >
                          {entry.subjectHomeName ?? `#${entry.subjectHomeId}`}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">
                          Every home
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
