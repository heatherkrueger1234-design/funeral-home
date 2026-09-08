import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTimelineTemplate,
  useCreateTimelineTemplate,
  useUpdateTimelineTemplate,
  useDeleteTimelineTemplate,
  getGetTimelineTemplateQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, X } from "lucide-react";

/**
 * The home's standard schedule, edited once and applied to every case.
 *
 * Offsets are chosen from a short list rather than typed as minutes. A
 * director thinks "three days before", not "-4320", and a free number field
 * here would be both harder to use and easy to get wrong by a factor of
 * sixty.
 */

const DAY = 24 * 60;

const OFFSETS: Array<{ value: number; label: string }> = [
  { value: -7 * DAY, label: "7 days before" },
  { value: -5 * DAY, label: "5 days before" },
  { value: -4 * DAY, label: "4 days before" },
  { value: -3 * DAY, label: "3 days before" },
  { value: -2 * DAY, label: "2 days before" },
  { value: -1 * DAY, label: "1 day before" },
  { value: -4 * 60, label: "4 hours before" },
  { value: 0, label: "On the day" },
  { value: 1 * DAY, label: "1 day after" },
  { value: 7 * DAY, label: "7 days after" },
];

export function StandardSchedule({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const template = useGetTimelineTemplate();

  const [title, setTitle] = useState("");
  const [offset, setOffset] = useState(String(-3 * DAY));

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetTimelineTemplateQueryKey(),
    });

  const add = useCreateTimelineTemplate({
    mutation: {
      onSuccess: () => {
        setTitle("");
        refresh();
      },
    },
  });
  const update = useUpdateTimelineTemplate({ mutation: { onSuccess: refresh } });
  const remove = useDeleteTimelineTemplate({ mutation: { onSuccess: refresh } });

  const rows = template.data ?? [];

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-medium">Standard schedule</h2>
        <p className="text-sm text-muted-foreground">
          Every case gets this the moment it has a service date, so nobody has
          to remember to tell a family when their clothing is due. Times are
          measured from the service.
        </p>
      </div>

      {template.isPending ? (
        <div className="py-6 text-center">
          <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate ${row.enabled ? "" : "text-muted-foreground line-through"}`}
                >
                  {row.title}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {row.offsetLabel}
                  {row.isEvent ? " · an event, not a task" : ""}
                </span>
              </span>

              <Switch
                checked={row.enabled}
                disabled={readOnly}
                aria-label={`Use "${row.title}" on new cases`}
                onCheckedChange={(checked) =>
                  update.mutate({
                    templateId: row.id,
                    data: { enabled: checked },
                  })
                }
              />

              <Button
                variant="ghost"
                size="icon"
                disabled={readOnly}
                className="text-muted-foreground"
                aria-label={`Remove ${row.title}`}
                onClick={() => remove.mutate({ templateId: row.id })}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate({
              data: { title: title.trim(), offsetMinutes: Number(offset) },
            });
          }}
        >
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label htmlFor="step">Add a step</Label>
            <Input
              id="step"
              placeholder="Bring clothing to the funeral home"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>When</Label>
            <Select value={offset} onValueChange={setOffset}>
              <SelectTrigger className="w-[10rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OFFSETS.map((entry) => (
                  <SelectItem key={entry.value} value={String(entry.value)}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" variant="outline" disabled={!title.trim()}>
            <Plus className="size-4" />
            Add
          </Button>
        </form>
      )}
    </section>
  );
}
