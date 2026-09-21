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
import { Loader2, MessageCircle, Moon, Phone, Send } from "lucide-react";
import { Empty, Loading, PageHeader } from "@/components/page";

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

  if (thread.isPending) return <Loading rows={3} />;

  if (!thread.data) return null;

  const {
    locked,
    withinOfficeHours,
    officeOpensMinute,
    urgentPhone,
  } = thread.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Messages">
        Everything in one place, so nothing gets lost between people.
      </PageHeader>

      <div className="space-y-2.5">
        {thread.data.messages.length === 0 && (
          <Empty icon={MessageCircle} title="Nothing yet">
            Ask anything at all — no question is too small, and there is no
            such thing as bothering them.
          </Empty>
        )}

        {thread.data.messages.map((message) => {
          const fromHome = message.authorSide === "home";

          return (
            /*
              The home's side is washed in the home's own colour and squared
              off at the corner nearest its own edge; the family's side is
              white card. Two shapes rather than two colours, so which is
              which survives a brand colour that happens to be pale.
            */
            <div
              key={message.id}
              className={[
                "max-w-[85%] px-4 py-3 shadow-[var(--elevation-1)]",
                fromHome
                  ? "rounded-xl rounded-bl-sm bg-[var(--accent-soft)] text-[var(--accent-deep)] ring-1 ring-inset ring-[var(--accent)]/12"
                  : "ml-auto rounded-xl rounded-br-sm border border-border bg-card",
              ].join(" ")}
            >
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {message.body}
              </p>
              <p
                className={[
                  "mt-2 text-xs",
                  fromHome
                    ? "text-[var(--accent-deep)]/65"
                    : "text-muted-foreground",
                ].join(" ")}
              >
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
        <p className="rounded-xl border border-border bg-[var(--sunken)] px-4 py-4 text-sm leading-relaxed text-muted-foreground">
          This conversation has been closed now that everything is finished.
          Please call the funeral home if you need them — they would rather
          hear from you than not.
        </p>
      ) : (
        <div className="space-y-3">
          {!withinOfficeHours && (
            <div className="rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5">
              <p className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <Moon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                <span>
                  Send this whenever you like — it will be waiting for them.
                  Your director reads messages from{" "}
                  {formatMinute(officeOpensMinute)}.
                </span>
              </p>
              {urgentPhone && (
                <a
                  href={`tel:${urgentPhone.replace(/[^\d+]/g, "")}`}
                  className="mt-2.5 flex items-center gap-2 text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
                >
                  <Phone className="size-4" />
                  If it can't wait, call {urgentPhone}
                </a>
              )}
            </div>
          )}

          {/*
            The box and its button are one panel. Two loose rectangles stacked
            on a page is what a form looks like; this is meant to look like
            somewhere to write.
          */}
          <div className="rounded-xl border border-border bg-card p-3 shadow-[var(--elevation-1)] focus-within:border-[var(--accent)]/50">
            <Textarea
              value={body}
              rows={3}
              placeholder="What would you like to ask?"
              className="min-h-24 resize-y border-0 bg-transparent p-1 shadow-none focus-visible:shadow-none"
              onChange={(event) => setBody(event.target.value)}
            />
            <Button
              type="button"
              className="mt-2 w-full"
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
        </div>
      )}
    </div>
  );
}
