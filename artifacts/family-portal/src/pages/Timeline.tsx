import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyDeadlines,
  useCompleteFamilyDeadline,
  useGetFamilySession,
  getGetFamilyDeadlinesQueryKey,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock, Church } from "lucide-react";
import { Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
import { formatAtHome } from "@/lib/utils";

/**
 * What is due, and when.
 *
 * Grieving people lose days. The point of this screen is that nobody has to
 * hold a week in their head: it is short, it is dated in words rather than
 * "in 3 days", and the funeral itself sits on the same list so the whole
 * week reads as one thing.
 *
 * An event is rendered without a checkbox. Putting a tickbox next to a
 * mother's funeral would be grotesque, and the API refuses it too — this is
 * the presentation half of the same rule. It is set apart visually as well:
 * the home's colour down the edge, the title in the serif. It is the only
 * thing on the list that is not a chore.
 */

/** On the home's clock — see `formatAtHome`. */
function formatDue(value: string | Date, timeZone: string | undefined): string {
  return formatAtHome(value, timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isOverdue(value: string | Date): boolean {
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime() < Date.now();
}

export default function Timeline() {
  const queryClient = useQueryClient();
  const deadlines = useGetFamilyDeadlines();
  const timeZone = useGetFamilySession().data?.home.timezone;

  const complete = useCompleteFamilyDeadline({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyDeadlinesQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
      },
    },
  });

  if (deadlines.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="What's due" />
        <Loading rows={4} />
      </div>
    );
  }

  if (deadlines.isError && !deadlines.data) {
    return <LoadFailed title="What's due" onRetry={() => void deadlines.refetch()} />;
  }

  const rows = deadlines.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader title="What's due">
        The funeral home keeps this up to date. If something here isn't
        possible, tell them — it can move.
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={CalendarClock} title="Nothing is waiting on you">
          When the funeral home adds something for you to do, it will appear
          here with the date it is needed by.
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const done = row.completedAt !== null;
            const late = !done && !row.isEvent && isOverdue(row.dueAt);

            return (
              <li
                key={row.id}
                className={[
                  // The background is chosen once. Naming two of them and
                  // hoping the later class wins is how the funeral row
                  // silently lost its wash: which of `bg-card` and
                  // `bg-[var(--accent-soft)]` applies is decided by the order
                  // Tailwind emits them in, not the order they are written.
                  "relative overflow-hidden rounded-xl border p-4 transition-gentle",
                  "shadow-[var(--elevation-1)]",
                  row.isEvent
                    ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] pl-5"
                    : late
                      ? "border-[var(--accent)]/40 bg-card pl-5"
                      : "border-border bg-card",
                  // No fading on a finished row: the strike-through says it
                  // is done, and dimming grey text on grey took it below
                  // readable contrast for the people this is written for.
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {(row.isEvent || late) && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]"
                  />
                )}

                <div className="flex items-start gap-3.5">
                  {row.isEvent ? (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/70 text-[var(--accent-deep)]">
                      <Church className="size-4" strokeWidth={1.75} />
                    </span>
                  ) : (
                    <Checkbox
                      // The box is drawn at 24px; the invisible margin round
                      // it makes the thing a finger has to hit 44px.
                      className="relative mt-0.5 size-6 after:absolute after:-inset-2.5 after:content-['']"
                      checked={done}
                      aria-label={`Mark "${row.title}" done`}
                      onCheckedChange={(checked) =>
                        complete.mutate({
                          deadlineId: row.id,
                          data: { completed: checked === true },
                        })
                      }
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        done
                          ? "text-muted-foreground line-through decoration-muted-foreground/50"
                          : row.isEvent
                            ? "font-display text-lg leading-snug text-[var(--accent-deep)]"
                            : "font-semibold"
                      }
                    >
                      {row.title}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {formatDue(row.dueAt, timeZone)}
                    </p>
                    {/*
                      Said once, in words, with what is true about it: the
                      date can move. "Overdue" in bold beside the date was
                      accurate and read as a mark against somebody.
                    */}
                    {late && (
                      <p className="mt-0.5 text-sm font-semibold text-[var(--accent-deep)]">
                        The date has passed, and it can move.
                      </p>
                    )}
                    {row.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {row.description}
                      </p>
                    )}
                    {done && row.completedByName && (
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        Done by {row.completedByName}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
