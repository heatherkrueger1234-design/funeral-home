import { useQueryClient } from "@tanstack/react-query";
import {
  useGetObituary,
  useUpdateObituary,
  useComposeObituary,
  useApproveObituary,
  useReopenObituary,
  getGetObituaryQueryKey,
  getGetCaseQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Check, RefreshCw, Undo2 } from "lucide-react";
import { Loading } from "@/components/page";

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
      // This panel explains its own failures; without the flag the console's
      // catch-all toast would say "That didn't save" on top of it.
      meta: { handlesOwnErrors: true },
      onSuccess: refresh,
      onError: (error) => {
        // Only the server's hand-edited refusal is a question about the
        // director's edits. Anything else — a dropped connection, a case
        // closed in another tab — telling them "that would replace your
        // edits" would send them looking for a problem that is not there.
        if (error instanceof ApiError && error.status === 409) {
          toast({
            title: "That would replace your edits",
            description:
              "Use “Recompose anyway” if you want to start again from the family's answers.",
          });
          return;
        }
        toast({
          title: "Couldn't compose that",
          description:
            error instanceof Error && error.message
              ? error.message
              : "Please check your connection and try again.",
          variant: "destructive",
        });
      },
    },
  });
  const reopen = useReopenObituary({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({
          title: "Reopened",
          description:
            "It's back with you to edit, and the family can change it from their portal again until you approve it.",
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
      <Loading />
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
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex items-center gap-1.5 text-sm text-[var(--accent-deep)]">
              <Check className="size-4" />
              Approved for print
            </p>
            {/*
              The way back for the misspelt name found after sign-off. Asked
              first, because approval is what the printer is working from.
            */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  disabled={reopen.isPending}
                >
                  <Undo2 className="size-4" />
                  Reopen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reopen the obituary?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It will no longer be approved for print, and the family
                    will be able to change it from their portal again until
                    you approve it once more. If anything has already gone to
                    the printer, let them know it is changing.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Leave it approved</AlertDialogCancel>
                  <AlertDialogAction onClick={() => reopen.mutate({ caseId })}>
                    Reopen it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
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
