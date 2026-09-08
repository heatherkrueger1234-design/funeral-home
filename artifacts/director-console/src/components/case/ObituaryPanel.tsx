import { useQueryClient } from "@tanstack/react-query";
import {
  useGetObituary,
  useUpdateObituary,
  useComposeObituary,
  useApproveObituary,
  getGetObituaryQueryKey,
  getGetCaseQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, RefreshCw } from "lucide-react";

/**
 * The obituary, from the director's side: the family's answers on the left,
 * the composed draft they can edit on the right.
 *
 * Recomposing is refused once the text has been hand-edited, and the refusal
 * is surfaced as a second confirming button rather than a silent overwrite —
 * losing a director's rewrite of a widow's obituary because a button was
 * ambiguous is not a recoverable mistake.
 */
export function ObituaryPanel({ caseId }: { caseId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const obituary = useGetObituary(caseId);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetObituaryQueryKey(caseId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  };

  const update = useUpdateObituary({ mutation: { onSuccess: refresh } });
  const compose = useComposeObituary({
    mutation: {
      onSuccess: refresh,
      onError: () => {
        toast({
          title: "That would replace your edits",
          description: "Use “Recompose anyway” if you want to start again from the family's answers.",
        });
      },
    },
  });
  const approve = useApproveObituary({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({
          title: "Approved for print",
          description: "The family can no longer change it from their portal.",
        });
      },
    },
  });

  if (obituary.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!obituary.data) return null;

  const draft = obituary.data;
  const edited = draft.draftEditedByStaff !== null;
  const approved = draft.status === "approved";

  const fields: Array<[string, string | null]> = [
    ["Full name", draft.fullName],
    ["Born", [draft.bornOn, draft.birthPlace].filter(Boolean).join(", ") || null],
    ["Died", [draft.diedOn, draft.deathPlace].filter(Boolean).join(", ") || null],
    ["Life", draft.biography],
    ["Survived by", draft.survivedBy],
    ["Preceded by", draft.precededBy],
    ["In lieu of flowers", draft.inLieuOfFlowers],
    ["Thanks", draft.specialThanks],
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h2 className="font-medium">
          What the family gave you
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {draft.status === "submitted"
              ? "· submitted"
              : draft.status === "approved"
                ? "· approved"
                : "· still being filled in"}
          </span>
        </h2>

        <dl className="space-y-3 rounded-xl border border-border bg-card p-4">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </dt>
              <dd className="whitespace-pre-wrap">
                {value || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">The draft</h2>
          <div className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={approved || compose.isPending}
              onClick={() => compose.mutate({ caseId, data: {} })}
            >
              <RefreshCw className="size-4" />
              Compose
            </Button>
            {edited && !approved && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => compose.mutate({ caseId, data: { force: true } })}
              >
                Recompose anyway
              </Button>
            )}
          </div>
        </div>

        <Textarea
          rows={18}
          defaultValue={draft.draftText ?? ""}
          disabled={approved}
          key={draft.draftText ?? ""}
          placeholder="Press Compose to draft this from the family's answers."
          onBlur={(event) => {
            const next = event.target.value;
            if (next === (draft.draftText ?? "")) return;
            update.mutate({ caseId, data: { draftText: next || null } });
          }}
        />

        {approved ? (
          <p className="flex items-center gap-1.5 text-sm text-[var(--accent-deep)]">
            <Check className="size-4" />
            Approved for print
          </p>
        ) : (
          <Button
            className="w-full"
            disabled={!draft.draftText?.trim() || approve.isPending}
            onClick={() => approve.mutate({ caseId })}
          >
            Approve for print
          </Button>
        )}
      </section>
    </div>
  );
}
