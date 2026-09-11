import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetIntakeRequests,
  useAcceptIntakeRequest,
  useDeclineIntakeRequest,
  getGetIntakeRequestsQueryKey,
  getGetCasesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Loader2, Mail, Phone, CalendarClock, Check } from "lucide-react";

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

export default function Requests() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [link, setLink] = useState<{ url: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const queue = useGetIntakeRequests({ status: "pending" });

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetIntakeRequestsQueryKey({ status: "pending" }),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
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
        });
      },
    },
  });

  const decline = useDeclineIntakeRequest({ mutation: { onSuccess: refresh } });

  if (queue.isPending) {
    return (
      <div className="py-16 grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = queue.data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-6">
        <h1 className="font-display text-2xl">Requests</h1>
        <p className="text-muted-foreground text-sm mt-1">
          People who found you themselves. Accepting one opens a case and gives
          you the link to send back.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-medium mb-1">Nothing waiting</p>
          <p className="text-sm text-muted-foreground">
            Requests from your public page land here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const preNeed = row.kind === "pre_need";

            return (
              <li
                key={row.id}
                className={`rounded-lg border p-4 ${
                  preNeed ? "" : "border-amber-300 bg-amber-50/50"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide mb-1
                                  text-muted-foreground">
                      {preNeed ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock className="size-3.5" />
                          Planning ahead — nobody has died
                        </span>
                      ) : (
                        <span className="text-amber-800">A death — ring them</span>
                      )}
                    </p>
                    <p className="font-medium">
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
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {ago(row.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-4 mt-3 text-sm">
                  {row.requesterPhone && (
                    <a
                      href={`tel:${row.requesterPhone.replace(/[^\d+]/g, "")}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Phone className="size-4" />
                      {row.requesterPhone}
                    </a>
                  )}
                  {row.requesterEmail && (
                    <a
                      href={`mailto:${row.requesterEmail}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Mail className="size-4" />
                      {row.requesterEmail}
                    </a>
                  )}
                </div>

                {row.note && (
                  <p className="mt-3 text-sm whitespace-pre-wrap rounded bg-muted/50 p-3">
                    {row.note}
                  </p>
                )}

                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    disabled={accept.isPending || decline.isPending}
                    onClick={() =>
                      accept.mutate({ intakeId: row.id })
                    }
                  >
                    {preNeed ? "Open a pre-need file" : "Open a case"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={accept.isPending || decline.isPending}
                    onClick={() => decline.mutate({ intakeId: row.id })}
                  >
                    Dismiss
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
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
            <code className="flex-1 rounded border bg-muted px-3 py-2 text-xs break-all">
              {link?.url}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!link) return;
                void navigator.clipboard?.writeText(link.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLink(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
