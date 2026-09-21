import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCaseMemories,
  useCreateCaseMemory,
  useUpdateMemory,
  useDeleteMemory,
  useEmailOfficiantBrief,
  getGetCaseMemoriesQueryKey,
  getGetOfficiantBriefUrl,
  type CaseMemory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Divider, Empty, Loading, Panel } from "@/components/page";
import {
  Check,
  Copy,
  Feather,
  Mail,
  Printer,
  Quote,
  Trash2,
  X,
} from "lucide-react";

/**
 * The family's own words, and the one sheet they turn into.
 *
 * Two jobs on one screen, pointing in opposite directions through time.
 *
 * Before the service: the family has been writing small specific things into
 * their portal, and a director can add the ones that arrive by telephone.
 * Whatever is ticked goes onto a sheet for whoever is taking the service —
 * which replaces a phone call in which a director reads out, from memory,
 * what a daughter said three days ago.
 *
 * After it: what was actually said. A eulogy currently survives only if a
 * relative kept the sheet of paper, and "could we have a copy of what the
 * minister said?" is a question homes get months later and can almost never
 * answer.
 */

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

function MemoryRow({
  memory,
  onToggleShare,
  onDelete,
}: {
  memory: CaseMemory;
  onToggleShare: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]">
      {memory.prompt && <p className="eyebrow mb-1.5">{memory.prompt}</p>}
      <p className="whitespace-pre-line leading-relaxed">{memory.body}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-2.5 text-sm">
        <span className="text-muted-foreground">
          {memory.authorName ?? "The family"}
          {memory.authorSide === "home" && " (you)"}
          {" · "}
          <time dateTime={String(memory.createdAt)}>
            {dateFormat.format(new Date(memory.createdAt))}
          </time>
        </span>

        {/*
          A director can tick one the family did not, because a family often
          says the best thing on the telephone and never types it. They cannot
          untick nothing into existence — what they are deciding is whether a
          line goes on the minister's sheet, which is exactly the judgement
          they are paid for.
        */}
        <button
          type="button"
          onClick={onToggleShare}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-gentle ${
            memory.forOfficiant
              ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-deep)]"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
          title={
            memory.forOfficiant
              ? "On the sheet for whoever is taking the service"
              : "Kept on the case, not on the sheet"
          }
        >
          {memory.forOfficiant ? (
            <Check className="size-3.5" strokeWidth={2.5} />
          ) : (
            <X className="size-3.5" strokeWidth={2.5} />
          )}
          {memory.forOfficiant ? "On the sheet" : "Not on the sheet"}
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-200 hover:text-[var(--destructive)]"
        >
          <Trash2 className="size-3.5" />
          Remove
        </button>
      </div>
    </li>
  );
}

export function MemoriesPanel({ caseId }: { caseId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const memories = useGetCaseMemories(caseId);

  const [note, setNote] = useState("");
  const [heard, setHeard] = useState("");
  const [heardFrom, setHeardFrom] = useState("");
  const [said, setSaid] = useState("");
  const [saidBy, setSaidBy] = useState("");
  const [to, setTo] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetCaseMemoriesQueryKey(caseId),
    });

  const create = useCreateCaseMemory({ mutation: { onSuccess: refresh } });
  const update = useUpdateMemory({ mutation: { onSuccess: refresh } });
  const remove = useDeleteMemory({ mutation: { onSuccess: refresh } });

  const email = useEmailOfficiantBrief({
    mutation: {
      onSuccess: (result) => {
        // The server distinguishes "this deployment cannot send email" from
        // "that address bounced", and so does this: only one of them is
        // worth trying a different address for.
        if (result.sent) {
          setTo("");
          setNote("");
          toast({
            title: `Sent to ${result.to}`,
            description: "Worth telling the family it has gone.",
          });
        } else {
          toast({
            title: "Not sent",
            description: result.reason ?? "Nothing was sent.",
            variant: "destructive",
          });
        }
      },
    },
  });

  if (memories.isPending) return <Loading rows={4} />;

  const rows = memories.data ?? [];
  const written = rows.filter((row) => row.kind === "memory");
  const tributes = rows.filter((row) => row.kind === "tribute");
  const onSheet = written.filter((row) => row.forOfficiant);

  const briefUrl = getGetOfficiantBriefUrl(caseId);

  const copyAll = async () => {
    const text = written
      .map((row) => `${row.prompt ? `${row.prompt}\n` : ""}${row.body}\n— ${row.authorName ?? "the family"}`)
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "All of it, ready to paste." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser refused. Select the text and copy it by hand.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-7">
      {/* ------------------------------------------------- the sheet -- */}
      <Panel>
        <h2 className="font-display text-lg">For whoever is taking the service</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          One page: the name and dates, the service, who is who in the family,
          the hymns and readings already chosen, and{" "}
          {onSheet.length === 0 ? (
            <strong className="font-semibold text-[var(--notice)]">
              nothing from the family yet
            </strong>
          ) : (
            <strong className="font-semibold text-foreground">
              {onSheet.length} {onSheet.length === 1 ? "memory" : "memories"}
            </strong>
          )}
          . It has ruled lines at the bottom, because it gets written on.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            {/*
              A new tab rather than a fetch-and-blob. The director reads it,
              presses Ctrl-P, and their own browser writes a better PDF than
              anything this app could bolt on.
            */}
            <a href={briefUrl} target="_blank" rel="noopener noreferrer">
              <Printer className="size-4" strokeWidth={1.75} />
              Open it to print
            </a>
          </Button>
          {written.length > 0 && (
            <Button type="button" variant="ghost" onClick={() => void copyAll()}>
              <Copy className="size-4" strokeWidth={1.75} />
              Copy all the words
            </Button>
          )}
        </div>

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="officiant-email">Or email it</Label>
              <Input
                id="officiant-email"
                type="email"
                className="mt-1.5"
                placeholder="the minister's address"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!to.trim() || email.isPending}
              onClick={() =>
                email.mutate({
                  caseId,
                  data: { to: to.trim(), note: note.trim() || null },
                })
              }
            >
              <Mail className="size-4" strokeWidth={1.75} />
              Send it
            </Button>
          </div>
          <div>
            <Label htmlFor="officiant-note">A line from you (optional)</Label>
            <Textarea
              id="officiant-note"
              className="mt-1.5 min-h-20"
              rows={2}
              placeholder="Anything else you need, just ring."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------- what the family wrote -- */}
      <section className="space-y-3">
        <Divider label="What the family wrote" />

        {written.length === 0 ? (
          <Empty icon={Feather} title="Nothing yet">
            The family can add these from their own link — there is a page for
            it with the questions on. Anything one of them tells you on the
            telephone can go in below.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {written.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                onToggleShare={() =>
                  update.mutate({
                    memoryId: memory.id,
                    data: { forOfficiant: !memory.forOfficiant },
                  })
                }
                onDelete={() => remove.mutate({ memoryId: memory.id })}
              />
            ))}
          </ul>
        )}

        <Panel>
          <Label htmlFor="heard">Something they told you</Label>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            The good ones almost always arrive on the telephone and never get
            typed anywhere. Put it here while you still have it.
          </p>
          <Textarea
            id="heard"
            className="mt-2"
            rows={3}
            value={heard}
            placeholder='"She used to feed every cat on the street and deny it."'
            onChange={(event) => setHeard(event.target.value)}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="heard-from">Who said it (optional)</Label>
              <Input
                id="heard-from"
                className="mt-1.5"
                placeholder="her daughter Anne"
                value={heardFrom}
                onChange={(event) => setHeardFrom(event.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!heard.trim() || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    caseId,
                    data: {
                      body: heard.trim(),
                      prompt: heardFrom.trim()
                        ? `Told to us by ${heardFrom.trim()}`
                        : null,
                      forOfficiant: true,
                    },
                  },
                  {
                    onSuccess: () => {
                      setHeard("");
                      setHeardFrom("");
                    },
                  },
                )
              }
            >
              <Check className="size-4" />
              Keep it
            </Button>
          </div>
        </Panel>
      </section>

      {/* ------------------------------------------------- after the service -- */}
      <section className="space-y-3">
        <Divider label="What was said" />
        <p className="max-w-prose text-sm leading-snug text-muted-foreground">
          Kept on the case and shown to the family in their portal. This is the
          thing they ring up asking for months later, when somebody is making
          the book — and the only copy is usually a folded sheet in a pocket.
        </p>

        {tributes.length > 0 && (
          <ul className="space-y-3">
            {tributes.map((memory) => (
              <li
                key={memory.id}
                className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]"
              >
                <Quote
                  className="mb-2 size-4 text-[var(--accent)]/50"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <p className="whitespace-pre-line leading-relaxed">{memory.body}</p>
                <div className="mt-3 flex items-center gap-3 border-t border-border pt-2.5 text-sm text-muted-foreground">
                  <span>{memory.authorName ?? "Unattributed"}</span>
                  <button
                    type="button"
                    onClick={() => remove.mutate({ memoryId: memory.id })}
                    className="ml-auto inline-flex items-center gap-1.5 text-xs transition-colors duration-200 hover:text-[var(--destructive)]"
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Panel>
          <Label htmlFor="said">Paste or type what was said</Label>
          <Textarea
            id="said"
            className="mt-2 min-h-40"
            rows={8}
            value={said}
            placeholder="The eulogy, the homily, or the two paragraphs somebody's son read out."
            onChange={(event) => setSaid(event.target.value)}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <Label htmlFor="said-by">Who said it</Label>
              <Input
                id="said-by"
                className="mt-1.5"
                placeholder="Rev. James Okafor"
                value={saidBy}
                onChange={(event) => setSaidBy(event.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!said.trim() || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    caseId,
                    data: {
                      kind: "tribute",
                      body: said.trim(),
                      authorName: saidBy.trim() || null,
                    },
                  },
                  {
                    onSuccess: () => {
                      setSaid("");
                      setSaidBy("");
                      toast({
                        title: "Kept",
                        description: "The family can read it in their portal.",
                      });
                    },
                  },
                )
              }
            >
              <Check className="size-4" />
              Keep it
            </Button>
          </div>
        </Panel>
      </section>
    </div>
  );
}
