import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCaseMessages,
  usePostCaseMessage,
  getGetCaseMessagesQueryKey,
  getGetCaseQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Moon, Send } from "lucide-react";

/**
 * The thread, from the home's side.
 *
 * Opening this tab marks the family's messages read, which is what clears the
 * badge on the worklist — the director's "which family is waiting on me"
 * signal is maintained by the act of actually looking.
 */
export function MessagesPanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const thread = useGetCaseMessages(caseId);
  const [body, setBody] = useState("");

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
      },
    },
  });

  if (thread.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!thread.data) return null;

  const { messages, locked, withinOfficeHours } = thread.data;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-muted-foreground">
            Nothing yet.
          </p>
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
              <p className="mt-1.5 text-xs text-muted-foreground">
                {message.authorName ?? (fromHome ? "The home" : "The family")}
                {message.authorTitle ? `, ${message.authorTitle}` : ""} ·{" "}
                {new Date(message.createdAt).toLocaleString(undefined, {
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
        <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
          This thread closed a fortnight after the service. Neither side can
          post to it.
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
