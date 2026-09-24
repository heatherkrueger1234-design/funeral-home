import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCaseMessages,
  usePostCaseMessage,
  getGetCaseMessagesQueryKey,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  getGetHomeDashboardQueryKey,
  getGetHomeInboxQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, Moon, Send } from "lucide-react";
import { Empty, LoadFailed, Loading } from "@/components/page";
import { formatAtHome } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";

/**
 * The thread, from the home's side.
 *
 * Opening this tab marks the family's messages read, which clears the "new"
 * badges. It does not stop the family counting as waiting on a reply — that
 * is worked out from who wrote last, so only an answer clears it.
 */
export function MessagesPanel({ caseId }: { caseId: number }) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();
  const thread = useGetCaseMessages(caseId);
  const [body, setBody] = useState("");

  /*
   * Reading the thread marks it read on the server (and the server now
   * finishes doing so before it answers), but the badges that count unread
   * messages live on other queries: the header's Messages badge on the
   * inbox, the tab's badge on the case, the worklist on the cases list.
   * Nothing refreshed them, so they kept saying there was something new for
   * up to a minute after the director had read it.
   */
  useEffect(() => {
    if (thread.dataUpdatedAt === 0) return;
    void queryClient.invalidateQueries({ queryKey: getGetHomeInboxQueryKey() });
    // And the same for the tab's own badge, the worklist row and the master
    // page's tile, which all count unread from the case: the tab went on
    // saying "1" beside the thread the director was reading.
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetHomeDashboardQueryKey() });
  }, [thread.dataUpdatedAt, queryClient, caseId]);

  const send = usePostCaseMessage({
    mutation: {
      onSuccess: () => {
        setBody("");
        void queryClient.invalidateQueries({
          queryKey: getGetCaseMessagesQueryKey(caseId),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetCaseQueryKey(caseId),
        });
        // Replying here is the same action as replying from the Inbox, and
        // must clear the same "waiting on a reply" signals — otherwise the
        // dashboard tile and the cases list only catch up on their next
        // poll or refocus.
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetCasesQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetHomeInboxQueryKey(),
        });
      },
    },
  });

  if (thread.isPending) {
    return (
      <Loading />
    );
  }

  if (!thread.data) {
    return <LoadFailed what="The messages" onRetry={() => void thread.refetch()} />;
  }

  const { messages, locked, withinOfficeHours } = thread.data;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {messages.length === 0 && (
          <Empty icon={MessageSquare} title="Nothing yet">
            Anything you write here reaches the family in their portal, not by
            text message.
          </Empty>
        )}

        {messages.map((message) => {
          const fromHome = message.authorSide === "home";

          return (
            <div
              key={message.id}
              className={`max-w-[80%] rounded-xl px-4 py-3 ${
                fromHome
                  ? "ml-auto bg-[var(--accent-soft)] text-[var(--accent-deep)]"
                  : "border border-border bg-card"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
                {message.authorName ?? (fromHome ? "The home" : "The family")}
                {message.authorTitle ? `, ${message.authorTitle}` : ""} ·{" "}
                {/* On the home's clock: "sent out of hours" below is judged
                    against the home's hours, and the time beside it should
                    agree with it. */}
                {formatAtHome(message.createdAt, zone, {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {/* Worth seeing: a family writing at 3am is a family who is
                    not coping, whatever the message says. */}
                {message.sentOutsideOfficeHours && !fromHome
                  ? " · sent out of hours"
                  : ""}
              </p>
            </div>
          );
        })}
      </div>

      {locked ? (
        <p className="rounded-xl border border-border bg-[var(--sunken)] px-4 py-4 text-sm leading-relaxed text-muted-foreground">
          This thread has closed, as every thread does once the service is
          past. Neither side can post to it.
        </p>
      ) : (
        <div className="space-y-3">
          {!withinOfficeHours && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Moon className="size-4" />
              You're outside your own office hours. The family is told you read
              messages from the morning.
            </p>
          )}

          <Textarea
            rows={3}
            value={body}
            placeholder="Reply to the family"
            aria-label="Reply to the family"
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            disabled={!body.trim() || send.isPending}
            onClick={() =>
              send.mutate({ caseId, data: { body: body.trim() } })
            }
          >
            {send.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        </div>
      )}
    </div>
  );
}
