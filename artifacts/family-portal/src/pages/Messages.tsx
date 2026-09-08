import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyMessages,
  usePostFamilyMessage,
  getGetFamilyMessagesQueryKey,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2, Moon, Phone, Send } from "lucide-react";

/**
 * One thread, with the funeral home.
 *
 * The office-hours notice is the whole reason this exists rather than a text
 * message. It appears *before* the family sends, it never blocks sending, and
 * it says something true: the message will arrive now and be read at eight.
 * Next to it is the number to ring if it genuinely cannot wait, which is what
 * makes the notice kind rather than a brush-off.
 */

function formatMinute(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatSent(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Messages() {
  const queryClient = useQueryClient();
  const thread = useGetFamilyMessages();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const send = usePostFamilyMessage({
    mutation: {
      onSuccess: () => {
        setBody("");
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyMessagesQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
      },
    },
  });

  const messages = thread.data?.messages;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  if (thread.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!thread.data) return null;

  const {
    locked,
    withinOfficeHours,
    officeOpensMinute,
    urgentPhone,
  } = thread.data;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl mb-1">Messages</h1>
        <p className="text-muted-foreground">
          Everything in one place, so nothing gets lost between people.
        </p>
      </header>

      <div className="space-y-3">
        {thread.data.messages.length === 0 && (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
            Nothing yet. Ask anything at all — no question is too small.
          </p>
        )}

        {thread.data.messages.map((message) => {
          const fromHome = message.authorSide === "home";

          return (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                fromHome
                  ? "bg-[var(--accent-soft)] text-[var(--accent-deep)]"
                  : "ml-auto bg-card border border-border"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {message.authorName ?? (fromHome ? "The funeral home" : "You")}
                {message.authorTitle ? `, ${message.authorTitle}` : ""} ·{" "}
                {formatSent(message.createdAt)}
              </p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {locked ? (
        <p className="rounded-xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
          This conversation has been closed now that everything is finished.
          Please call the funeral home if you need them — they would rather
          hear from you than not.
        </p>
      ) : (
        <div className="space-y-3">
          {!withinOfficeHours && (
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Moon className="mt-0.5 size-4 shrink-0" />
                <span>
                  Send this whenever you like — it will be waiting for them.
                  Your director reads messages from{" "}
                  {formatMinute(officeOpensMinute)}.
                </span>
              </p>
              {urgentPhone && (
                <a
                  href={`tel:${urgentPhone.replace(/[^\d+]/g, "")}`}
                  className="mt-2 flex items-center gap-2 text-sm font-medium text-[var(--accent-deep)]"
                >
                  <Phone className="size-4" />
                  If it can't wait, call {urgentPhone}
                </a>
              )}
            </div>
          )}

          <Textarea
            value={body}
            rows={3}
            placeholder="What would you like to ask?"
            onChange={(event) => setBody(event.target.value)}
          />
          <Button
            type="button"
            className="w-full"
            disabled={!body.trim() || send.isPending}
            onClick={() => send.mutate({ data: { body: body.trim() } })}
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
