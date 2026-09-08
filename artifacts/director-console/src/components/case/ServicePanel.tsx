import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSelections,
  useUpdateSelection,
  useDeleteSelection,
  getGetSelectionsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Check, Loader2, X } from "lucide-react";

const LABELS: Record<string, string> = {
  hymn: "Hymns",
  reading: "Readings",
  music: "Music",
  pallbearer: "Pallbearers",
  eulogist: "Speaking",
  other: "Other",
};

/**
 * What the family has chosen, and the one action that matters: confirming it.
 *
 * Confirming is what puts an entry into the order of service at the printer,
 * and it is also what stops the family removing it from under you.
 */
export function ServicePanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const selections = useGetSelections(caseId);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetSelectionsQueryKey(caseId),
    });

  const update = useUpdateSelection({ mutation: { onSuccess: refresh } });
  const remove = useDeleteSelection({ mutation: { onSuccess: refresh } });

  if (selections.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = selections.data ?? [];

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
        The family has not chosen anything yet.
      </p>
    );
  }

  const kinds = [...new Set(rows.map((row) => row.kind))];

  return (
    <div className="space-y-6">
      {kinds.map((kind) => (
        <section key={kind} className="space-y-2">
          <h2 className="font-medium">{LABELS[kind] ?? kind}</h2>
          <ul className="space-y-2">
            {rows
              .filter((row) => row.kind === kind)
              .map((row) => {
                const confirmed = row.confirmedAt !== null;

                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{row.value}</span>
                      {row.attribution && (
                        <span className="block text-sm text-muted-foreground truncate">
                          {row.attribution}
                        </span>
                      )}
                    </span>

                    <Button
                      variant={confirmed ? "secondary" : "outline"}
                      size="sm"
                      onClick={() =>
                        update.mutate({
                          selectionId: row.id,
                          data: { confirmed: !confirmed },
                        })
                      }
                    >
                      <Check className="size-4" />
                      {confirmed ? "Confirmed" : "Confirm"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      aria-label={`Remove ${row.value}`}
                      onClick={() => remove.mutate({ selectionId: row.id })}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
