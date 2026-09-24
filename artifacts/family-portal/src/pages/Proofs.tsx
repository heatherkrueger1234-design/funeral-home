import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyPrintItems,
  useGetFamilySession,
  usePostFamilyMessage,
  getGetFamilyMessagesQueryKey,
} from "@workspace/api-client-react";
import { Check, FileCheck, Loader2, Pencil, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
import { useAuthedPrintUrl } from "@/hooks/use-authed-print-url";

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

/**
 * The family's answer about one proof, sent as a message to the home.
 *
 * There is no approving a proof from the family's side — that is the home's
 * signature to the printer — but "tell your director" with nowhere to tell
 * them left the family to find the messages screen and describe which card
 * they meant. The answer goes into the same conversation as everything else,
 * already naming the card, so the director reads it where they read the rest.
 */
function ProofAnswer({ title }: { title: string }) {
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [change, setChange] = useState("");
  const [sent, setSent] = useState<"right" | "change" | null>(null);
  const sending = useRef(false);

  const send = usePostFamilyMessage({
    mutation: {
      onSettled: () => {
        sending.current = false;
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyMessagesQueryKey(),
        });
      },
    },
  });

  const post = (body: string, kind: "right" | "change") => {
    if (sending.current) return;
    sending.current = true;
    send.mutate(
      { data: { body } },
      {
        onSuccess: () => {
          setSent(kind);
          setWriting(false);
          setChange("");
        },
      },
    );
  };

  if (sent) {
    return (
      <p
        role="status"
        className="mt-3 flex items-start gap-2.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3 text-sm leading-relaxed"
      >
        <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent-deep)]" />
        {sent === "right"
          ? "Sent to the funeral home. They'll see it with your messages."
          : "Sent to the funeral home. They'll make the change and show you the new one here."}
      </p>
    );
  }

  if (writing) {
    const id = `change-${title.replace(/\W+/g, "-").toLowerCase()}`;
    return (
      <div className="mt-3 space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]">
        <Label htmlFor={id}>What needs changing?</Label>
        <Textarea
          id={id}
          rows={3}
          value={change}
          placeholder="Her granddaughter's name is spelled Siobhan, not Shivaun."
          onChange={(event) => setChange(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!change.trim() || send.isPending}
            onClick={() => post(`About “${title}”: ${change.trim()}`, "change")}
          >
            {send.isPending && <Loader2 className="size-4 animate-spin" />}
            Send to the funeral home
          </Button>
          <Button type="button" variant="ghost" onClick={() => setWriting(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <Button
        type="button"
        variant="outline"
        disabled={send.isPending}
        onClick={() =>
          post(`I've read “${title}” and everything in it looks right.`, "right")
        }
      >
        {send.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        It all looks right
      </Button>
      <Button type="button" variant="outline" onClick={() => setWriting(true)}>
        <Pencil className="size-4" />
        Something needs changing
      </Button>
    </div>
  );
}

function ProofItem({
  item,
  canAnswer,
}: {
  item: { id: number; title: string | null; templateName: string; status: string };
  canAnswer: boolean;
}) {
  const title = item.title ?? item.templateName;
  const { src, isPending, isError, pageWidth } = useAuthedPrintUrl(item.id);

  return (
    <li>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        {item.status === "approved" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-sm font-semibold text-[var(--accent-deep)]">
            <Check className="size-3" />
            Approved for printing
          </span>
        )}
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
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          <Printer className="size-4" />
          Open it full size
        </a>
      )}

      {canAnswer && <ProofAnswer title={title} />}
    </li>
  );
}

export default function Proofs() {
  const items = useGetFamilyPrintItems();
  const session = useGetFamilySession();
  // Answers go into the conversation with the home, which closes with the
  // arrangements; after that, the telephone is the way to reach them.
  const canAnswer = session.data?.messagesLocked === false;

  if (items.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title="Things to check" />
        <Loading rows={2} />
      </div>
    );
  }

  // Not "Nothing to check", which would send them away from proofs that
  // are there.
  if (items.isError && !items.data) {
    return (
      <LoadFailed title="Things to check" onRetry={() => void items.refetch()} />
    );
  }

  const rows = items.data ?? [];

  return (
    <div className="space-y-7">
      <PageHeader title="Things to check">
        {canAnswer
          ? "Please read the names carefully — spellings are the one thing we can't check for you. Under each one, tell the funeral home whether it's right."
          : "Please read the names carefully — spellings are the one thing we can't check for you. If anything is wrong, please call the funeral home."}
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={FileCheck} title="Nothing to check at the moment">
          When the funeral home has a card, a booklet or an order of service
          ready, it will appear here for you to read before it is printed.
        </Empty>
      ) : (
        <ul className="space-y-10">
          {rows.map((item) => (
            <ProofItem key={item.id} item={item} canAnswer={canAnswer} />
          ))}
        </ul>
      )}
    </div>
  );
}
