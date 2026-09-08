import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBelongings,
  useCreateBelonging,
  useUpdateBelonging,
  useDeleteBelonging,
  useGetPreparation,
  useUpdatePreparation,
  getGetBelongingsQueryKey,
  getGetPreparationQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, Plus, X } from "lucide-react";

/**
 * The custody log, and the sheet that goes to the preparation room.
 *
 * The status control is one click per item on purpose. A director logging a
 * ring at the front desk with a family standing there will do one tap; they
 * will not fill in a form, and a record that needs a form is a record that
 * does not exist when somebody asks where the ring went.
 */

const STATUSES = [
  { value: "expected", label: "Expected" },
  { value: "received", label: "Received" },
  { value: "with_deceased", label: "With them" },
  { value: "returned", label: "Returned" },
];

const DISPOSITIONS = [
  { value: "undecided", label: "Undecided" },
  { value: "with_deceased", label: "Stays with them" },
  { value: "return_to_family", label: "Back to family" },
];

function formatWhen(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function BelongingsPanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const items = useGetBelongings(caseId);
  const preparation = useGetPreparation(caseId);
  const [description, setDescription] = useState("");

  const refreshItems = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetBelongingsQueryKey(caseId),
    });
  const refreshPrep = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetPreparationQueryKey(caseId),
    });

  const add = useCreateBelonging({
    mutation: {
      onSuccess: () => {
        setDescription("");
        refreshItems();
      },
    },
  });
  const update = useUpdateBelonging({ mutation: { onSuccess: refreshItems } });
  const remove = useDeleteBelonging({ mutation: { onSuccess: refreshItems } });
  const savePrep = useUpdatePreparation({ mutation: { onSuccess: refreshPrep } });

  if (items.isPending || preparation.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = items.data ?? [];
  const prep = preparation.data;
  const outstanding = rows.filter(
    (item) => item.disposition === "return_to_family" && item.returnedAt === null,
  ).length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">In your care</h2>
          {outstanding > 0 && (
            <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent-deep)]">
              {outstanding} to return
            </span>
          )}
        </div>

        <ul className="space-y-2">
          {rows.map((item) => (
            <li
              key={item.id}
              className="space-y-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex items-start gap-2">
                <Input
                  defaultValue={item.description}
                  className="h-9"
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (!next || next === item.description) return;
                    update.mutate({
                      belongingId: item.id,
                      data: { description: next },
                    });
                  }}
                />
                {item.receivedAt === null && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground"
                    aria-label={`Remove ${item.description}`}
                    onClick={() => remove.mutate({ belongingId: item.id })}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Select
                  value={item.status}
                  onValueChange={(value) =>
                    update.mutate({
                      belongingId: item.id,
                      data: { status: value as "received" },
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-[8.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={item.disposition}
                  onValueChange={(value) =>
                    update.mutate({
                      belongingId: item.id,
                      data: { disposition: value as "undecided" },
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-[9.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPOSITIONS.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* The line that answers "who took the ring in?". */}
              {item.receivedAt && (
                <p className="text-xs text-muted-foreground">
                  Taken in {formatWhen(item.receivedAt)}
                  {item.receivedByName ? ` by ${item.receivedByName}` : ""}
                  {item.returnedAt
                    ? ` · returned ${formatWhen(item.returnedAt)}${
                        item.returnedToName ? ` to ${item.returnedToName}` : ""
                      }`
                    : ""}
                </p>
              )}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Input
            value={description}
            placeholder="Add an item"
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (description.trim()) {
                add.mutate({ caseId, data: { description: description.trim() } });
              }
            }}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Add item"
            disabled={!description.trim()}
            onClick={() =>
              add.mutate({ caseId, data: { description: description.trim() } })
            }
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Preparation</h2>
          {prep?.reviewedAt ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5" />
              Read by {prep.reviewedByName ?? "staff"}
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() =>
                savePrep.mutate({ caseId, data: { reviewed: true } })
              }
            >
              Mark as read
            </Button>
          )}
        </div>

        {prep?.referencePhotoUploadId && (
          <div>
            <Label className="mb-1.5 block">How they looked</Label>
            <img
              src={`/api/uploads/${prep.referencePhotoUploadId}`}
              alt="Reference photograph"
              className="w-40 rounded-lg border border-border object-cover"
            />
          </div>
        )}

        {(
          [
            ["hairNotes", "Hair"],
            ["cosmeticsNotes", "Makeup"],
            ["jewelleryNotes", "Jewellery to be worn"],
            ["otherNotes", "Anything else"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="space-y-1.5">
            <Label htmlFor={field}>{label}</Label>
            <Textarea
              id={field}
              rows={2}
              defaultValue={prep?.[field] ?? ""}
              placeholder="Nothing from the family yet"
              onBlur={(event) =>
                savePrep.mutate({
                  caseId,
                  data: { [field]: event.target.value.trim() || null },
                })
              }
            />
          </div>
        ))}
      </section>
    </div>
  );
}
