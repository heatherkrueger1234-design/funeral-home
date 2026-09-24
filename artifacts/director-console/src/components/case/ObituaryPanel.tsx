import { useState } from "react";
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
import { Check, RefreshCw } from "lucide-react";
import { Confirm, LoadFailed, Loading } from "@/components/page";

/**
 * The obituary, from the director's side: the family's answers on the left,
 * the composed draft they can edit on the right.
 *
 * Recomposing over a hand-edited draft asks first, in a dialog that says
 * what will be lost — losing a director's rewrite of a widow's obituary
 * because a button was ambiguous is not a recoverable mistake. It used to
 * try, fail on the server and show an error; the question is now asked
 * before anything is sent.
 *
 * Approval stops the *family* changing it. The home still can, because the
 * typo somebody spots the evening before the printer is the home's to fix.
 */
export function ObituaryPanel({ caseId }: { caseId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const obituary = useGetObituary(caseId);
  // What is in the box now, which may be ahead of what the server has.
  const [text, setText] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetObituaryQueryKey(caseId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
  };

  const update = useUpdateObituary({ mutation: { onSuccess: refresh } });
  const compose = useComposeObituary({
    mutation: {
      onSuccess: () => {
        setText(null);
        refresh();
      },
    },
  });
  const approve = useApproveObituary({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({
          title: "Approved for print",
          description:
            "The family can no longer change it from their portal. You still can, here.",
        });
      },
    },
  });

  if (obituary.isPending) {
    return <Loading />;
  }

  if (!obituary.data) {
    return <LoadFailed what="The obituary" onRetry={() => void obituary.refetch()} />;
  }

  const draft = obituary.data;
  const edited = draft.draftEditedByStaff !== null;
  const approved = draft.status === "approved";
  const saved = draft.draftText ?? "";
  const current = text ?? saved;
  const unsaved = current !== saved;

  const saveText = () => {
    if (!unsaved) return Promise.resolve();
    return update.mutateAsync({ caseId, data: { draftText: current || null } });
  };

  /*
   * Save whatever is in the box, then approve. Approving straight from the
   * box used to send the two requests side by side, so the text the family
   * saw locked could be the version from before the last sentence typed.
   */
  const saveAndApprove = async () => {
    try {
      await saveText();
    } catch {
      return;
    }
    approve.mutate({ caseId });
  };

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

  const composeButton = (
    <Button variant="ghost" size="sm" disabled={compose.isPending}>
      <RefreshCw className="size-4" />
      {saved.trim() ? "Compose again" : "Compose"}
    </Button>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h2 className="font-display text-lg">
          What the family gave you
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {draft.status === "submitted"
              ? "· submitted"
              : draft.status === "approved"
                ? "· approved"
                : "· still being filled in"}
          </span>
        </h2>

        <dl className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
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
          <h2 className="font-display text-lg">The draft</h2>
          <div className="ml-auto flex gap-1">
            {edited || unsaved ? (
              <Confirm
                trigger={composeButton}
                title="Start again from the family's answers?"
                description="Your changes to the draft are replaced with a fresh one composed from what the family gave you. This cannot be undone."
                confirmLabel="Replace my changes"
                cancelLabel="Keep my changes"
                onConfirm={() => compose.mutate({ caseId, data: { force: true } })}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={compose.isPending}
                onClick={() => compose.mutate({ caseId, data: {} })}
              >
                <RefreshCw className="size-4" />
                {saved.trim() ? "Compose again" : "Compose"}
              </Button>
            )}
          </div>
        </div>

        <Textarea
          rows={18}
          aria-label="The obituary draft"
          value={current}
          placeholder="Press Compose to draft this from the family's answers."
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void saveText().catch(() => undefined)}
        />

        {approved ? (
          <p className="flex items-center gap-1.5 text-sm text-[var(--accent-deep)]">
            <Check className="size-4" />
            Approved for print. The family can no longer change it; you can.
          </p>
        ) : (
          <Button
            className="w-full"
            disabled={!current.trim() || approve.isPending || update.isPending}
            onClick={() => void saveAndApprove()}
          >
            Approve for print
          </Button>
        )}
      </section>
    </div>
  );
}
