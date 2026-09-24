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
import { Empty, Loading } from "@/components/page";
import { formatAtHome } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";

/**
 * The thread, from the home's side.
 *
 * Opening this tab marks the family's messages read, which is what clears the
 * badge on the worklist — the director's "which family is waiting on me"
 * signal is maintained by the act of actually looking.
 */
export function MessagesPanel({ caseId }: { caseId: number }) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();
  const thread = useGetCaseMessages(caseId);
  const [body, setBody] = useState("");

  /*
   * Reading the thread marks it read on the server, and the header's
   * Messages badge is counted from the inbox -- which nothing refreshed, so
   * the badge kept saying a family was waiting for up to a minute after the
   * director had read and answered them.
   */
  useEffect(() => {
    if (thread.dataUpdatedAt === 0) return;
    void queryClient.invalidateQueries({ queryKey: getGetHomeInboxQueryKey() });
    // The same count is on this case's own Messages tab, on its row in the
    // case list and on the master page's tile.
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
    void queryClient.invalidateQueries({
      queryKey: getGetHomeDashboardQueryKey(),
    });
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

  if (!thread.data) return null;

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
          This thread closed when its window after the service ran out.
          Neither side can post to it.
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
            aria-label="Reply to the family"
            placeholder="Reply to the family"
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
