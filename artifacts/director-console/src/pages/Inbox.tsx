import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHomeInbox,
  usePostCaseMessage,
  getGetHomeInboxQueryKey,
  getGetCaseMessagesQueryKey,
  getGetHomeDashboardQueryKey,
  getGetCasesQueryKey,
  getGetCaseQueryKey,
} from "@workspace/api-client-react";
import type { InboxEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Divider, Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
import { cn, formatAtHome } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";
import { Loader2, Moon, Lock, MessageSquare, Send } from "lucide-react";

/**
 * Every family conversation in one list.
 *
 * The product's promise is one contained thread per family, and that promise
 * is kept case by case. The cost was that a director working four funerals
 * could only find out the Okonkwo family wrote at midnight by opening the
 * Okonkwo case — so the thread nobody opened was the one nobody answered.
 *
 * Replies are written here, but they are *sent* through the case's own
 * endpoint, which is the single place the out-of-hours stamp is applied and
 * the fortnight lock is enforced. This screen is a faster way into that door,
 * not a second one.
 *
 * What it deliberately does not offer is sending the same message to several
 * families at once. There is no circumstance in this business where that is
 * the right thing to do, and building it would be building the thing this
 * product was sold as an alternative to.
 */

/** On the home's clock -- see `formatAtHome`. */
const messageTime = (value: string | Date, zone: string | undefined) =>
  formatAtHome(value, zone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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

export default function Inbox() {
  const inbox = useGetHomeInbox({
    query: { queryKey: getGetHomeInboxQueryKey(), refetchInterval: 60_000 },
  });

  if (inbox.isPending) return <Loading rows={4} />;
  if (inbox.isError) {
    return <LoadFailed what="The messages" onRetry={() => void inbox.refetch()} />;
  }

  const rows = inbox.data ?? [];
  // Waiting means the home can still do something about it. A locked thread
  // drops to the lower group however much is unread behind it, because there
  // is no reply box on it to act with.
  const waiting = rows.filter((row) => row.unreadFromFamily > 0 && !row.locked);
  const rest = rows.filter((row) => !waiting.includes(row));

  return (
    <div className="space-y-6">
      <PageHeader title="Messages">
        Every family, in one place. The ones waiting on you are first.
      </PageHeader>

      {rows.length === 0 ? (
        <Empty icon={MessageSquare} title="No conversations yet">
          A thread starts when you or a family writes on a case.
        </Empty>
      ) : (
        <>
          {waiting.length > 0 && (
            <ul className="space-y-3">
              {waiting.map((row) => (
                <Conversation key={row.caseId} row={row} />
              ))}
            </ul>
          )}

          {rest.length > 0 && (
            <section className="space-y-3">
              {waiting.length > 0 && <Divider label="Answered" />}
              <ul className="space-y-3">
                {rest.map((row) => (
                  <Conversation key={row.caseId} row={row} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Conversation({ row }: { row: InboxEntry }) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);

  const send = usePostCaseMessage({
    mutation: {
      onSuccess: () => {
        setReply("");
        setOpen(false);
        void queryClient.invalidateQueries({
          queryKey: getGetHomeInboxQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetCaseMessagesQueryKey(row.caseId),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        void queryClient.invalidateQueries({
          queryKey: getGetCaseQueryKey(row.caseId),
        });
      },
    },
  });

  const body = reply.trim();
  const waiting = row.unreadFromFamily > 0;

  return (
    <li
      className={cn(
        "rounded-xl border p-4 shadow-[var(--elevation-1)]",
        waiting
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/cases/${row.caseId}?tab=messages`}
            className="font-semibold no-underline hover:underline"
          >
            {row.decedentName}
          </Link>
          {row.kind === "pre_need" && (
            /* Never a word of condolence to somebody who is perfectly well. */
            <span className="ml-2 text-xs text-muted-foreground">
              Planning ahead
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap text-right">
          <span className="block">{ago(row.lastMessageAt)}</span>
          <span className="block">{messageTime(row.lastMessageAt, zone)}</span>
        </div>
      </div>

      <p className="mt-2 text-sm">
        <span className="text-muted-foreground">
          {row.lastMessageFrom === "home" ? "You: " : ""}
        </span>
        {row.lastMessageBody}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {waiting && (
          <span className="tabular rounded-full bg-[var(--accent)] px-2 py-0.5 font-semibold text-white">
            {row.unreadFromFamily} unread
          </span>
        )}
        {/*
          Context for a director reading at eight, not a prompt to answer at
          two. The product's whole position on office hours is that a message
          sent at 2am is delivered at 2am and nobody is expected to be awake
          for it.
        */}
        {row.sentOutsideOfficeHours && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Moon className="size-3" />
            sent outside your hours
          </span>
        )}
        {row.locked && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Lock className="size-3" />
            closed
          </span>
        )}
      </div>

      {!row.locked && (
        <div className="mt-3">
          {open ? (
            <div className="space-y-2">
              <Textarea
                autoFocus
                aria-label={`Reply about ${row.decedentName}`}
                rows={3}
                value={reply}
                placeholder={`Reply to the ${row.decedentName.split(" ").slice(-1)[0]} family`}
                onChange={(event) => setReply(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!body || send.isPending}
                  onClick={() =>
                    send.mutate({ caseId: row.caseId, data: { body } })
                  }
                >
                  {send.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    setReply("");
                  }}
                >
                  Cancel
                </Button>
                <Button asChild size="sm" variant="ghost" className="ml-auto">
                  <Link href={`/cases/${row.caseId}?tab=messages`}>
                    See the whole thread
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Reply
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
