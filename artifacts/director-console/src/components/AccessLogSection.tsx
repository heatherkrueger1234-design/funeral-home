import { useInfiniteQuery } from "@tanstack/react-query";
import {
  getHomeAccessLog,
  getGetHomeAccessLogQueryKey,
} from "@workspace/api-client-react";
import type { HomeAccessEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { LoadingLines } from "@/components/page";
import { useHomeZone } from "@/lib/session";
import { whenLabel } from "@/lib/when";
import { Eye, RotateCcw } from "lucide-react";

const PAGE_SIZE = 25;

/**
 * Every time anyone at Continuum Aftercare opened this home, or changed
 * something on it, from the platform's own access log.
 *
 * This is the DPA's strongest sentence made into something the owner can
 * check for themselves rather than ask us for: "almost nobody, never
 * silently, and here is the log". It is read-only and owner-only on the
 * server; this screen is only ever drawn for an owner.
 *
 * What the console used to open a home cannot reach is said in the
 * introduction, because it is the reassurance the log exists to back up: the
 * platform console has no screen for a case, a photograph or a message.
 */
export function AccessLogSection() {
  const zone = useHomeZone();

  const log = useInfiniteQuery({
    queryKey: getGetHomeAccessLogQueryKey({ limit: PAGE_SIZE }),
    queryFn: ({ pageParam }) =>
      getHomeAccessLog({
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { before: pageParam }),
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });

  const entries = log.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
      <div className="space-y-1.5">
        <h2 className="font-display text-lg">
          Who at Continuum Aftercare has looked
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Every time anyone here opened your account or changed something on
          it, from our own log, which is written before anything is shown to
          them. The console we use has no screen for a family's case,
          photographs or messages. Only owners see this list.
        </p>
      </div>

      {log.isPending ? (
        <LoadingLines lines={3} />
      ) : log.isError && entries.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            The log couldn't be loaded. Nothing has been lost.
          </p>
          <Button variant="outline" size="sm" onClick={() => void log.refetch()}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Eye className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Nobody at Continuum Aftercare has opened your account yet.
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {entries.map((entry: HomeAccessEntry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{entry.what}</span>
                <span className="block break-all text-sm text-muted-foreground">
                  {entry.who}
                  {entry.detail ? ` · ${entry.detail}` : ""}
                </span>
              </span>
              <span className="tabular whitespace-nowrap text-xs text-muted-foreground">
                {whenLabel(entry.at, zone)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {log.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? "Loading…" : "Show older"}
        </Button>
      )}
      {log.isFetchNextPageError && (
        <p className="text-sm text-muted-foreground">
          The older entries didn't load. Please try again.
        </p>
      )}
    </section>
  );
}
