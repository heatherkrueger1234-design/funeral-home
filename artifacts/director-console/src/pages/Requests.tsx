import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetIntakeRequests,
  useAcceptIntakeRequest,
  useDeclineIntakeRequest,
  getGetIntakeRequestsQueryKey,
  getGetCasesQueryKey,
  getGetHomeDashboardQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Inbox, Mail, Phone, CalendarClock, Check } from "lucide-react";
import { Confirm, Empty, LoadFailed, Loading, PageHeader } from "@/components/page";

/**
 * People who asked, and whom nobody has answered yet.
 *
 * Two very different rows land in the same list, and the difference has to be
 * unmissable at a glance: a family whose person has died in the last few hours
 * and needs a telephone call before anything else, and somebody perfectly well
 * who is planning ahead and for whom there is no hurry at all. Sorting them
 * together and colouring them the same would have a director ringing the wrong
 * one first.
 *
 * Oldest first, because this is a queue of people waiting.
 */

function ago(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Clipboard access can be refused; the link is on screen either way. */
function copyFailed() {
  toast({
    title: "Couldn't copy that",
    description: "Select the link and copy it by hand.",
  });
}

export default function Requests() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [link, setLink] = useState<{
    url: string;
    name: string;
    caseId: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const queue = useGetIntakeRequests({ status: "pending" });

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetIntakeRequestsQueryKey({ status: "pending" }),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetHomeDashboardQueryKey() });
  };

  const accept = useAcceptIntakeRequest({
    mutation: {
      onSuccess: (created) => {
        refresh();
        // The link is returned exactly once. Show it before anything else can
        // navigate away from it.
        setLink({
          url: created.familyLink,
          name: created.displayName ?? "the family",
          caseId: created.id,
        });
      },
      // A second director accepting the same request gets a 409 here. The
      // global error toast already explains why; without this, the row
      // itself stayed on screen looking untouched, with both buttons still
      // enabled — inviting a repeat click on a request that is already
      // spoken for. Refreshing clears it from the pending queue.
      onError: (error) => {
        refresh();
        toast({
          title: "That request has already been dealt with",
          description:
            error instanceof Error && error.message.trim()
              ? error.message
              : "Somebody else here may have answered it. The list has been refreshed.",
          variant: "destructive",
        });
      },
    },
  });

  const decline = useDeclineIntakeRequest({ mutation: { onSuccess: refresh } });

  if (queue.isPending) return <Loading rows={3} />;

  if (queue.isError) {
    return <LoadFailed what="The requests" onRetry={() => void queue.refetch()} />;
  }

  const rows = queue.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Requests">
        People who found you themselves. Accepting one opens a case and gives
        you the link to send back.
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={Inbox} title="Nothing waiting">
          Requests from your public page land here. Somebody who has your link
          already goes straight into their own portal instead.
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const preNeed = row.kind === "pre_need";

            return (
              <li
                key={row.id}
                className={`relative overflow-hidden rounded-xl border bg-card p-4 shadow-[var(--elevation-1)] ${
                  preNeed
                    ? "border-border"
                    : "border-[var(--notice)]/35 pl-5"
                }`}
              >
                {!preNeed && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1 bg-[var(--notice)]"
                  />
                )}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1.5">
                      {preNeed ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-3.5" />
                          Planning ahead — nobody has died
                        </span>
                      ) : (
                        <span className="text-[var(--notice)]">
                          A death — call them
                        </span>
                      )}
                    </p>
                    <p className="font-semibold">
                      {preNeed
                        ? row.requesterName
                        : `${row.subjectDisplayName}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {preNeed
                        ? "For themselves"
                        : `${row.requesterName}${
                            row.relationship ? ` — ${row.relationship}` : ""
                          }`}
                    </p>
                  </div>
                  <p className="tabular shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                    {ago(row.createdAt)}
                  </p>
                </div>

                <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                  {row.requesterPhone && (
                    <a
                      href={`tel:${row.requesterPhone.replace(/[^\d+]/g, "")}`}
                      className="tabular inline-flex items-center gap-1.5 font-semibold
                                 text-[var(--accent-deep)] no-underline hover:underline"
                    >
                      <Phone className="size-4" strokeWidth={1.75} />
                      {row.requesterPhone}
                    </a>
                  )}
                  {row.requesterEmail && (
                    <a
                      href={`mailto:${row.requesterEmail}`}
                      className="inline-flex items-center gap-1.5 font-semibold
                                 text-[var(--accent-deep)] no-underline hover:underline"
                    >
                      <Mail className="size-4" strokeWidth={1.75} />
                      {row.requesterEmail}
                    </a>
                  )}
                </div>

                {row.note && (
                  <p className="mt-3.5 whitespace-pre-wrap rounded-lg border border-border
                                bg-[var(--sunken)] p-3.5 text-sm leading-relaxed">
                    {row.note}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={accept.isPending || decline.isPending}
                    onClick={() =>
                      accept.mutate({ intakeId: row.id })
                    }
                  >
                    {preNeed ? "Open a pre-need file" : "Open a case"}
                  </Button>
                  {/*
                    Asked twice, because a request dismissed by a slip of the
                    finger is a family who never gets the telephone call they
                    were promised by your page, and nothing tells them.
                  */}
                  <Confirm
                    trigger={
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={accept.isPending || decline.isPending}
                      >
                        Dismiss
                      </Button>
                    }
                    title={`Dismiss ${preNeed ? row.requesterName : row.subjectDisplayName}'s request?`}
                    description="It leaves this list and no case is opened. They are sent nothing, so if they need telling, tell them yourself."
                    confirmLabel="Dismiss it"
                    cancelLabel="Keep it"
                    onConfirm={() => decline.mutate({ intakeId: row.id })}
                  />
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                  Dismissing sends them nothing. If they need telling, tell them
                  yourself.
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={link !== null} onOpenChange={() => setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The case is open</DialogTitle>
            <DialogDescription>
              Send this link to {link?.name}. You will not see it again — if it
              goes astray, issue a fresh one from the case, which also stops the
              old one working.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <code className="flex-1 break-all rounded-md border border-border bg-[var(--sunken)]
                             px-3 py-2.5 font-mono text-xs leading-relaxed">
              {link?.url}
            </code>
            <Button
              variant="outline"
              aria-label="Copy the link"
              onClick={() => {
                if (!link) return;
                // Missing outside a secure context, as well as refusable.
                if (!navigator.clipboard) {
                  copyFailed();
                  return;
                }
                void navigator.clipboard
                  .writeText(link.url)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(copyFailed);
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLink(null)}>
              Stay on requests
            </Button>
            {/* The next thing is almost always the case itself: a date,
                the rest of the family, the photographs. */}
            <Button
              onClick={() => {
                if (!link) return;
                const caseId = link.caseId;
                setLink(null);
                navigate(`/cases/${caseId}`);
              }}
            >
              Open the case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
