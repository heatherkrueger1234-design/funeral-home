import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetFamilyMessagesQueryKey,
  getGetFamilyPrintItemsQueryKey,
  getGetFamilySessionQueryKey,
  useApproveFamilyPrintItem,
  useGetFamilyPrintItems,
  useGetFamilySession,
  useRequestFamilyPrintChanges,
} from "@workspace/api-client-react";
import type { PrintItem } from "@workspace/api-client-react";
import { Check, FileCheck, Loader2, Maximize2, PencilLine } from "lucide-react";
import { Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthedPrintUrl } from "@/hooks/use-authed-print-url";
import { plainError } from "@/lib/memory-book";

/**
 * Proofs the funeral home has shared.
 *
 * There is one job on this screen and it is spelling. The most common reason
 * cards get reprinted is a misspelled name — usually a grandchild's, in a
 * list nobody outside the family could check — and the family is the only
 * party who can catch it. So the ask is specific rather than "does this look
 * alright": read the names.
 *
 * Shown as the real rendered card rather than a description, because a
 * summary is not something you can proofread. The frame around it is
 * deliberately plain and deliberately white: this is the only place in the
 * portal where the product's own styling would get in the way of judging how
 * something will look on paper.
 *
 * And it ends in an answer. A proof nobody can sign off is a question the
 * home asks and then waits on forever, so each card waiting on the family
 * carries two buttons: it's right, or something needs changing. Either one
 * lands in the message thread, which is where the director already looks.
 */

/** Room either side of the card inside the frame, as the template draws it. */
const MOUNT = 32;
/** The height of the window onto the card, in CSS pixels (30rem at 16px). */
const WINDOW = 480;

/**
 * The card, scaled to fit the width it is given.
 *
 * The templates are drawn at their printed size — an order of service is
 * five and three-quarter inches across — and a phone column is about three
 * and three-quarters. Drawn at full size it showed the left two-thirds of
 * the card with the names cut off at the right edge, which on a screen whose
 * whole purpose is reading the names is the one thing it cannot do. Scaled
 * down it is small but whole, and "Open it full size" is there for reading
 * it closely.
 */
function ProofFrame({
  src,
  title,
  pageWidth,
}: {
  src: string;
  title: string;
  pageWidth: number | null;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setAvailable(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const natural = pageWidth === null ? null : pageWidth + MOUNT;
  const scale =
    natural !== null && available !== null && natural > available
      ? available / natural
      : 1;

  return (
    <div ref={holder} className="relative overflow-hidden" style={{ height: WINDOW }}>
      {/* Sandboxed: an object URL is same-origin with the portal, so
          without this the card would run with the family's token in
          reach. It is a picture of a card; it needs to run nothing. */}
      <iframe
        title={title}
        src={src}
        sandbox=""
        className="absolute left-0 top-0 origin-top-left border-0"
        style={{
          width: scale < 1 && natural !== null ? natural : "100%",
          height: WINDOW / scale,
          transform: scale < 1 ? `scale(${scale})` : undefined,
        }}
      />
    </div>
  );
}

type Answer = "approve" | "changes";

function StatusPill({ item }: { item: PrintItem }) {
  if (item.status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-deep)]">
        <Check className="size-3" />
        {item.approvedByName ? `Approved by ${item.approvedByName}` : "Approved"}
      </span>
    );
  }
  if (item.changesRequestedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-semibold text-foreground">
        <PencilLine className="size-3" />
        Being changed
      </span>
    );
  }
  if (item.status === "proof") {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--accent)]/40 px-2 py-0.5 text-xs font-semibold text-[var(--accent-deep)]">
        Waiting for you
      </span>
    );
  }
  return null;
}

function ProofItem({
  item,
  canApprove,
  onAnswer,
}: {
  item: PrintItem;
  canApprove: boolean;
  onAnswer: (item: PrintItem, answer: Answer) => void;
}) {
  const title = item.title ?? item.templateName;
  const { src, isPending, isError, pageWidth } = useAuthedPrintUrl(item.id);
  const [enlarged, setEnlarged] = useState(false);
  const waiting = item.status === "proof";

  return (
    <li>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <StatusPill item={item} />
      </div>

      {/*
        A hair of extra elevation and a white mount, so the proof reads as a
        sheet of paper sitting on the page rather than as another panel of
        the website.
      */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-white shadow-[var(--elevation-2)]">
        {src ? (
          <ProofFrame src={src} title={title} pageWidth={pageWidth} />
        ) : (
          <div
            role="img"
            aria-label={isError ? `${title} (could not be shown)` : title}
            aria-busy={isPending || undefined}
            className={`grid h-[30rem] w-full place-items-center bg-[var(--muted)] px-6 text-center text-sm text-muted-foreground ${isPending ? "animate-pulse" : ""}`}
          >
            {isError && "This one couldn't be shown just now. Please try again in a little while."}
          </div>
        )}
      </div>

      {src && (
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          <Maximize2 className="size-4" />
          Open it full size
        </button>
      )}

      {item.changesRequestedAt && item.changesRequestedNote && (
        <div className="mt-4 rounded-xl border border-border bg-[var(--sunken)] p-4 text-sm">
          <p className="font-semibold">
            {item.changesRequestedBy ? `${item.changesRequestedBy} asked for a change` : "You asked for a change"}
          </p>
          <p className="mt-1 whitespace-pre-line text-muted-foreground">
            {item.changesRequestedNote}
          </p>
          <p className="mt-2 text-muted-foreground">
            The funeral home has this. They'll send a new proof here when it's ready.
          </p>
        </div>
      )}

      {waiting && (
        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
          {canApprove && (
            <Button type="button" onClick={() => onAnswer(item, "approve")}>
              <Check className="size-4" />
              It's right — approve it
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onAnswer(item, "changes")}
          >
            <PencilLine className="size-4" />
            Something needs changing
          </Button>
        </div>
      )}
      {waiting && !canApprove && (
        <p className="mt-2 text-sm text-muted-foreground">
          The family's main contact signs it off. If you spot a mistake, say so
          — that matters more.
        </p>
      )}

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              As it will be printed. Read every name slowly.
            </DialogDescription>
          </DialogHeader>
          {src && (
            <iframe
              title={`${title}, full size`}
              src={src}
              sandbox=""
              className="h-[75vh] w-full rounded-lg border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

export default function Proofs() {
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const items = useGetFamilyPrintItems();
  const [answering, setAnswering] = useState<{ item: PrintItem; answer: Answer } | null>(null);
  const [note, setNote] = useState("");

  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: getGetFamilyPrintItemsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilySessionQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilyMessagesQueryKey() });
    setAnswering(null);
    setNote("");
  };

  const approve = useApproveFamilyPrintItem({ mutation: { onSuccess: settle } });
  const changes = useRequestFamilyPrintChanges({ mutation: { onSuccess: settle } });
  const busy = approve.isPending || changes.isPending;
  const failure = answering?.answer === "approve" ? approve.error : changes.error;

  if (items.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Things to check" />
        <Loading rows={2} />
      </div>
    );
  }

  if (items.isError) {
    return <LoadFailed title="Things to check" onRetry={() => void items.refetch()} />;
  }

  // What is waiting on them first; what is settled after. The server's
  // order is "most recently touched", which puts a just-approved card above
  // the one they still have to read.
  const rank = (item: PrintItem) =>
    item.status === "proof" ? 0 : item.changesRequestedAt ? 1 : 2;
  const rows = [...(items.data ?? [])].sort((a, b) => rank(a) - rank(b));
  const canApprove = session.data?.contact.role === "next_of_kin";
  const homeName = session.data?.home.name ?? "The funeral home";

  const open = (item: PrintItem, answer: Answer) => {
    approve.reset();
    changes.reset();
    setNote("");
    setAnswering({ item, answer });
  };

  const answeringTitle = answering ? (answering.item.title ?? answering.item.templateName) : "";

  return (
    <div className="space-y-7">
      <PageHeader title="Things to check">
        Please read the names carefully — spellings are the one thing we can't
        check for you. When it's right, approve it; if anything is wrong, say
        what, and it will be fixed before anything is printed.
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={FileCheck} title="Nothing to check at the moment">
          When the funeral home has a card, a booklet or an order of service
          ready, it will appear here for you to read before it is printed.
        </Empty>
      ) : (
        <ul className="space-y-10">
          {rows.map((item) => (
            <ProofItem key={item.id} item={item} canApprove={canApprove} onAnswer={open} />
          ))}
        </ul>
      )}

      <AlertDialog
        open={answering?.answer === "approve"}
        onOpenChange={(value) => !value && !busy && setAnswering(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {answeringTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              {homeName} will print it exactly as it is shown. Every name
              spelled the way you'd want it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failure && (
            <p role="alert" className="text-sm text-[var(--destructive)]">
              {plainError(failure)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Let me look again</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (answering) approve.mutate({ printItemId: answering.item.id });
              }}
            >
              {approve.isPending && <Loader2 className="size-4 animate-spin" />}
              Yes, print it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={answering?.answer === "changes"}
        onOpenChange={(value) => !value && !busy && setAnswering(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What needs changing on {answeringTitle}?</DialogTitle>
            <DialogDescription>
              Say it however is easiest — "Grandson is Jaxon with an x", or
              "use the photo from the garden instead".
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const text = note.trim();
              if (!answering || !text || busy) return;
              changes.mutate({ printItemId: answering.item.id, data: { note: text } });
            }}
          >
            <Textarea
              aria-label="What needs changing"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={5}
              autoFocus
            />
            {failure && (
              <p role="alert" className="text-sm text-[var(--destructive)]">
                {plainError(failure)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setAnswering(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !note.trim()}>
                {changes.isPending && <Loader2 className="size-4 animate-spin" />}
                Send to the funeral home
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
