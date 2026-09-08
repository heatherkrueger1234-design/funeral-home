import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyDeadlines,
  useCompleteFamilyDeadline,
  getGetFamilyDeadlinesQueryKey,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock, Church, Loader2 } from "lucide-react";

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
 * the presentation half of the same rule.
 */

function formatDue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
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
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = deadlines.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">What's due</h1>
        <p className="text-muted-foreground">
          The funeral home keeps this up to date. If something here isn't
          possible, tell them — it can move.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <CalendarClock className="size-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            Nothing is waiting on you at the moment.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const done = row.completedAt !== null;
            const late = !done && !row.isEvent && isOverdue(row.dueAt);

            return (
              <li
                key={row.id}
                className={`rounded-xl border bg-card p-4 ${
                  late ? "border-[var(--accent)]" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  {row.isEvent ? (
                    <span className="grid size-6 shrink-0 place-items-center text-[var(--accent-deep)]">
                      <Church className="size-5" />
                    </span>
                  ) : (
                    <Checkbox
                      className="mt-0.5 size-6"
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
                        done ? "line-through text-muted-foreground" : "font-medium"
                      }
                    >
                      {row.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDue(row.dueAt)}
                    </p>
                    {row.description && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {row.description}
                      </p>
                    )}
                    {done && row.completedByName && (
                      <p className="mt-1 text-sm text-muted-foreground">
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
