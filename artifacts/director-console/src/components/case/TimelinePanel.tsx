import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDeadlines,
  useApplyTimelineTemplate,
  useCreateDeadline,
  useUpdateDeadline,
  useDeleteDeadline,
  getGetDeadlinesQueryKey,
  getGetCaseQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarSync, Church, Loader2, Plus, X } from "lucide-react";

/**
 * The timeline the family is shown.
 *
 * Kept deliberately spartan — a director building a thirty-item project plan
 * here would produce a screen the family reads none of. Four or five things,
 * each with a real time.
 */
export function TimelinePanel({
  caseId,
  serviceAt,
}: {
  caseId: number;
  serviceAt: string | null;
}) {
  const queryClient = useQueryClient();
  const deadlines = useGetDeadlines(caseId);

  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [isEvent, setIsEvent] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetDeadlinesQueryKey(caseId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  };

  const add = useCreateDeadline({
    mutation: {
      onSuccess: () => {
        setTitle("");
        setDueAt("");
        setIsEvent(false);
        refresh();
      },
    },
  });
  const update = useUpdateDeadline({ mutation: { onSuccess: refresh } });
  const applyTemplate = useApplyTimelineTemplate({
    mutation: { onSuccess: refresh },
  });
  const remove = useDeleteDeadline({ mutation: { onSuccess: refresh } });

  const rows = deadlines.data ?? [];

  return (
    <div className="space-y-6">
      {/*
        The escape hatch for the one case the standard schedule got wrong,
        and the button to press after a funeral moves. Steps already done keep
        their date; unfinished ones follow the service.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {serviceAt
            ? "Built from your standard schedule."
            : "Set a service date on the Details tab and the schedule builds itself."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!serviceAt || applyTemplate.isPending}
          onClick={() => applyTemplate.mutate({ caseId })}
        >
          {applyTemplate.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CalendarSync className="size-4" />
          )}
          {rows.length === 0 ? "Build the schedule" : "Rebuild from template"}
        </Button>
      </div>

      {deadlines.isPending ? (
        <div className="py-12 text-center">
          <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">
          Nothing on the timeline yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const done = row.completedAt !== null;

            return (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
              >
                {row.isEvent ? (
                  <Church className="size-5 shrink-0 text-[var(--accent-deep)]" />
                ) : (
                  <Checkbox
                    checked={done}
                    aria-label={`Mark "${row.title}" done`}
                    onCheckedChange={(checked) =>
                      update.mutate({
                        deadlineId: row.id,
                        data: { completed: checked === true },
                      })
                    }
                  />
                )}

                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate ${done ? "line-through text-muted-foreground" : ""}`}
                  >
                    {row.title}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {new Date(row.dueAt).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {done && row.completedByName ? ` · done by ${row.completedByName}` : ""}
                  </span>
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label={`Remove ${row.title}`}
                  onClick={() => remove.mutate({ deadlineId: row.id })}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="space-y-4 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate({
            caseId,
            data: {
              title: title.trim(),
              dueAt: new Date(dueAt).toISOString(),
              isEvent,
            },
          });
        }}
      >
        <p className="font-medium">Add to the timeline</p>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="title">What</Label>
            <Input
              id="title"
              required
              placeholder="Deliver clothing to the funeral home"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dueAt">When</Label>
            <Input
              id="dueAt"
              type="datetime-local"
              required
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isEvent}
            onCheckedChange={(checked) => setIsEvent(checked === true)}
          />
          This happens, rather than needing doing — the family sees no checkbox
        </label>

        <Button type="submit" disabled={add.isPending || !title.trim() || !dueAt}>
          {add.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Add
        </Button>
      </form>
    </div>
  );
}
