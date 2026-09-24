import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
} from "@/components/ui";

/** As much as the API will give in one answer. Past that, filter. */
const FIRST_PAGE = 100;
const MOST = 200;

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
  /*
   * The filters live in the address, so "every time anyone opened Cedar &
   * Stone" is a link -- the home's own page links here with `?home=` -- and
   * so it survives a reload and can be sent to a colleague.
   */
  const params = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const rawHome = params.get("home");
  const homeId = rawHome && /^[1-9]\d*$/.test(rawHome) ? Number(rawHome) : null;
  const action = params.get("action") ?? "";
  const limit = params.get("more") ? MOST : FIRST_PAGE;

  const setFilter = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    navigate(query ? `/audit?${query}` : "/audit", { replace: true });
  };

  const query = useQuery({
    queryKey: ["audit", homeId, action, limit],
    queryFn: () =>
      api.get<AuditEntry[]>(
        `/admin/audit?limit=${limit}` +
          (homeId ? `&homeId=${homeId}` : "") +
          (action ? `&action=${encodeURIComponent(action)}` : ""),
      ),
    placeholderData: keepPreviousData,
    // Opening a home writes a line here, so a log fifteen seconds stale is
    // missing the very visit that brought somebody to it.
    staleTime: 0,
  });

  const homeName =
    query.data?.find((entry) => entry.subjectHomeId === homeId)
      ?.subjectHomeName ?? (homeId ? `home #${homeId}` : null);

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
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="w-full max-w-xs">
          <Select
            label="Show"
            value={action}
            onChange={(event) => setFilter({ action: event.target.value, more: null })}
          >
            <option value="">Everything</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {homeId && (
          <p className="flex min-h-11 flex-wrap items-center gap-x-3 text-sm">
            <span>
              Only <span className="font-semibold">{homeName}</span>
            </span>
            <button
              type="button"
              className="min-h-11 text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
              onClick={() => setFilter({ home: null, more: null })}
            >
              Show every home
            </button>
          </p>
        )}
      </div>

      {query.isPending ? (
        <LoadingRows rows={8} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        homeId || action ? (
          <EmptyState
            title="Nothing matches"
            detail="Nobody has done that yet, or not to this home."
            action={
              <Button onClick={() => navigate("/audit", { replace: true })}>
                Show everything
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Nothing logged yet"
            detail="The first time anyone opens a home from this console, it will appear here."
          />
        )
      ) : (
        <Card className="overflow-hidden p-0">
          {/* A phone gets the same entries as sentences; four columns of a
              log do not fit 390 pixels, and a sideways-scrolling table hid
              the "what", which is the column that matters. */}
          <ul className="divide-y divide-[var(--border)] md:hidden">
            {query.data.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                <What entry={entry} />
                <Subject entry={entry} />
                <span className="text-[var(--muted-foreground)] break-words">
                  {formatDateTime(entry.createdAt)} ·{" "}
                  {entry.actorEmail.replace("@", "\u200b@")}
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
                {query.data.map((entry) => (
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
                      {entry.actorEmail.replace("@", "\u200b@")}
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
      )}

      {query.data && query.data.length >= limit && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            {limit === MOST
              ? `These are the latest ${MOST}. Choosing what to show, or a single home, reaches further back.`
              : `The latest ${FIRST_PAGE}.`}
          </p>
          {limit !== MOST && (
            <Button onClick={() => setFilter({ more: "1" })}>
              Show the latest {MOST}
            </Button>
          )}
        </div>
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

  // Not "every home": a group, the access list and the overview name no
  // single home, and the homes list says in its detail what it showed.
  return (
    <span className="text-[var(--muted-foreground)]">
      {entry.action.startsWith("group.")
        ? "A group"
        : entry.action.startsWith("platform.admin")
          ? "The access list"
          : "Across homes"}
    </span>
  );
}
