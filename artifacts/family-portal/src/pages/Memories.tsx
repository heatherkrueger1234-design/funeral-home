import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyMemories,
  useGetFamilySession,
  useCreateFamilyMemory,
  useUpdateFamilyMemory,
  useDeleteFamilyMemory,
  getGetFamilyMemoriesQueryKey,
  type CaseMemory,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Guidance, Point } from "@/components/Guidance";
import { Circumstances } from "@/components/Circumstances";
import { Divider, Empty, Loading, PageHeader } from "@/components/page";
import { voiceFor } from "@/lib/voice";
import { useToast } from "@/hooks/use-toast";
import { Check, Feather, Printer, Quote, Trash2, X } from "lucide-react";

/**
 * Somewhere to put a small specific story at the moment somebody remembers it.
 *
 * This is the screen the obituary form could not be. That form asks named
 * questions and gets named answers — dates, places, who survives whom — and
 * it is right to. But its one open field is labelled "their life", which is a
 * blank box by another name, and a blank box is the thing the rest of the
 * form exists to avoid.
 *
 * The difference here is that nothing is one answer. A family adds a few
 * sentences at a time, from whoever's phone is nearest, over a week, against
 * questions small enough to answer standing up in a kitchen. What comes out
 * is the raw material for three different things — the obituary the home
 * writes, the eulogy somebody in the family has to stand up and give, and the
 * sheet the minister is handed — and none of those is a thing this screen
 * asks anybody to write.
 *
 * The consent tick is the load-bearing part. A family writes things here that
 * are for them, and things that are for saying out loud, and the difference
 * between the two is not ours to guess.
 */

/**
 * The questions.
 *
 * Small, concrete, and answerable by somebody who is exhausted. "Tell us
 * about their life" is not a question; "what did they always say?" is, and
 * the answer to it is usually the line that ends up in the eulogy.
 *
 * They live here rather than on the server on purpose. The chosen wording is
 * stored on each memory as it was asked, so a memory stays readable for as
 * long as the case exists whatever happens to this list — which means the
 * list is free to be rewritten, translated, or tuned by a home later without
 * migrating anybody's mother's story.
 */
const PROMPTS: readonly string[] = [
  "What were they like when you were small?",
  "What did they always say?",
  "What were they doing when they were happiest?",
  "What did they teach you?",
  "Something that would make the family laugh",
  "What did they look after?",
  "Where did they come from, and how did they get here?",
  "What would they want said?",
];

const timeFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
});

function Composer({
  prompt,
  onCancel,
  onSave,
  saving,
}: {
  prompt: string | null;
  onCancel: () => void;
  onSave: (body: string, forOfficiant: boolean) => void;
  saving: boolean;
}) {
  const [body, setBody] = useState("");
  // Ticked to begin with. Almost everything written here is written to be
  // said, and a family that has to opt *in* to being heard mostly forgets to
  // — which leaves the minister with an empty sheet and the family wondering
  // why nothing they wrote was mentioned.
  const [forOfficiant, setForOfficiant] = useState(true);

  return (
    <div className="rounded-xl border border-[var(--accent)]/30 bg-card p-4 shadow-[var(--elevation-1)]">
      {prompt && <p className="eyebrow mb-2">{prompt}</p>}

      <Textarea
        autoFocus
        rows={5}
        value={body}
        placeholder="A few sentences is plenty."
        onChange={(event) => setBody(event.target.value)}
      />

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm leading-snug">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          checked={forOfficiant}
          onChange={(event) => setForOfficiant(event.target.checked)}
        />
        <span className="text-muted-foreground">
          Share this with whoever is taking the service.{" "}
          <span className="text-foreground">
            Leave it unticked to keep it just for the family.
          </span>
        </span>
      </label>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          disabled={body.trim().length === 0 || saving}
          onClick={() => onSave(body.trim(), forOfficiant)}
        >
          <Check className="size-4" />
          Keep it
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  mine,
  onToggleShare,
  onDelete,
}: {
  memory: CaseMemory;
  mine: boolean;
  onToggleShare: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]">
      {memory.prompt && <p className="eyebrow mb-1.5">{memory.prompt}</p>}

      {/* The line breaks somebody typed are the only formatting there is. */}
      <p className="whitespace-pre-line leading-relaxed">{memory.body}</p>

      {/*
        Outside the controls below, because this is the one part of the row
        that belongs on paper: somebody reading these aloud needs to know
        whose memory they are reading.
      */}
      <p className="mt-2 text-sm text-muted-foreground">
        {memory.authorName ?? "Someone in the family"}
        {" · "}
        <time dateTime={String(memory.createdAt)}>
          {timeFormat.format(new Date(memory.createdAt))}
        </time>
      </p>

      <div className="no-print mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">

        {mine && (
          <>
            <button
              type="button"
              onClick={onToggleShare}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-gentle ${
                memory.forOfficiant
                  ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-deep)]"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {memory.forOfficiant ? (
                <Check className="size-3.5" strokeWidth={2.5} />
              ) : (
                <X className="size-3.5" strokeWidth={2.5} />
              )}
              {memory.forOfficiant ? "For the service" : "Just for us"}
            </button>

            <button
              type="button"
              onClick={onDelete}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-200 hover:text-[var(--destructive)]"
            >
              <Trash2 className="size-3.5" />
              Remove
            </button>
          </>
        )}

        {!mine && memory.forOfficiant && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-deep)]">
            <Check className="size-3.5" strokeWidth={2.5} />
            For the service
          </span>
        )}
      </div>
    </article>
  );
}

export default function Memories() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const memories = useGetFamilyMemories();
  const [writing, setWriting] = useState<{ prompt: string | null } | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetFamilyMemoriesQueryKey(),
    });

  const create = useCreateFamilyMemory({
    mutation: {
      onSuccess: () => {
        setWriting(null);
        refresh();
        toast({
          title: "Kept",
          description: "You can add another whenever something comes back to you.",
        });
      },
    },
  });

  const update = useUpdateFamilyMemory({ mutation: { onSuccess: refresh } });
  const remove = useDeleteFamilyMemory({ mutation: { onSuccess: refresh } });

  if (memories.isPending || session.isPending) return <Loading rows={4} />;

  const rows = memories.data ?? [];
  const written = rows.filter((row) => row.kind === "memory");
  const said = rows.filter((row) => row.kind === "tribute");
  const contactId = session.data?.contact.id;
  const voice = voiceFor(session.data?.case.kind);
  const subject = session.data?.case.displayName ?? "them";

  // Questions nobody has answered yet, so the list shrinks as it is used
  // rather than showing eight prompts to somebody who has answered six.
  const answered = new Set(written.map((row) => row.prompt).filter(Boolean));
  const remaining = PROMPTS.filter((prompt) => !answered.has(prompt));

  return (
    <div className="space-y-7 pb-16">
      <PageHeader
        title={voice.preNeed ? "Things to say" : "Things to remember"}
        aside={
          /*
            Promised in the guidance below — "you can print the lot, and take
            it with you" — so it has to exist. The portal's own print
            stylesheet already drops the header, the footer and anything
            marked `no-print`, which here is the guidance, the questions and
            every button: what comes out of the printer is the words and who
            said them, on the home's paper, ready to be read from.
          */
          written.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="no-print"
              onClick={() => window.print()}
            >
              <Printer className="size-4" strokeWidth={1.75} />
              Print these
            </Button>
          ) : undefined
        }
      >
        {voice.preNeed
          ? "What you would want said, and the stories you would want told. Add them whenever one comes to you."
          : "The small things — what they said, what they did, what only your family would find funny. A few sentences at a time, whenever one comes back to you."}
      </PageHeader>

      <div className="no-print space-y-3">
      <Guidance title="What happens to these">
        <p>
          {voice.preNeed
            ? "Anything you write here is kept with your plan, for whoever has to speak one day."
            : `${session.data?.home.name} uses these three ways.`}
        </p>
        <Point lead="The obituary.">
          The funeral home writes it. These are what they write it from — the
          details only your family knows.
        </Point>
        <Point lead="Whoever takes the service.">
          Anything you tick is printed on a sheet for them. It is the
          difference between a service about a person and a service about
          somebody they never met.
        </Point>
        <Point lead="Anyone in the family who has to speak.">
          You can print the lot, and take it with you.
        </Point>
        <p>
          Nothing you leave unticked goes anywhere. It stays here, for the
          family, for as long as this page does.
        </p>
      </Guidance>

      <Guidance title="If you have to stand up and speak">
        <p>
          Nobody is expecting a speech. Three or four minutes is plenty, and
          the ones people remember are nearly always the shortest.
        </p>
        <Point lead="Two or three moments, not a life story.">
          One thing they always said, one thing they did, one thing only your
          family would find funny. A list of dates is a CV.
        </Point>
        <Point lead="Say their name.">
          Out loud, often. It is the reason everybody is in the room.
        </Point>
        <Point lead="Write it out and read it.">
          Nobody minds, nobody notices, and losing your place is the thing
          that makes it harder — not the reading.
        </Point>
        <Point lead="End on a line you can get through.">
          Something plain and short. The last sentence is the hardest one to
          say, so do not save the heaviest thing for it.
        </Point>
        <p>
          And if you get partway and cannot finish, someone will pick it up.
          That happens at a great many funerals and it has never once been the
          thing anybody remembered afterwards.
        </p>
      </Guidance>

      {/*
        The same block the obituary page carries, and deliberately on both.
        Whichever of the two screens a family opens first is the one where
        they get stuck, and it is not predictable which.
      */}
      <Guidance title="If you don't know what to say">
        <p>
          Some deaths are harder to write about than others, and nobody has
          done this before. Open whichever of these is yours — nothing is
          recorded, and nothing here is a rule.
        </p>
        <Circumstances />
      </Guidance>
      </div>

      {writing ? (
        <Composer
          prompt={writing.prompt}
          saving={create.isPending}
          onCancel={() => setWriting(null)}
          onSave={(body, forOfficiant) =>
            create.mutate({
              data: { body, prompt: writing.prompt, forOfficiant },
            })
          }
        />
      ) : (
        <section className="no-print space-y-3">
          <Divider label={written.length === 0 ? "Somewhere to start" : "Another one"} />
          <div className="flex flex-wrap gap-2">
            {remaining.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setWriting({ prompt })}
                className="lift rounded-full border border-border bg-card px-3.5 py-2 text-left text-sm
                           shadow-[var(--elevation-1)] transition-gentle
                           hover:border-[var(--accent)] hover:text-[var(--accent-deep)]"
              >
                {prompt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setWriting({ prompt: null })}
              className="rounded-full border border-dashed border-[var(--border-strong)] px-3.5 py-2
                         text-sm text-muted-foreground transition-gentle
                         hover:border-[var(--accent)] hover:text-[var(--accent-deep)]"
            >
              Something else
            </button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <Divider label={`About ${voice.preNeed ? "you" : subject}`} />
        {written.length === 0 ? (
          <Empty icon={Feather} title="Nothing written down yet">
            Pick one of the questions above. There is no wrong answer and no
            minimum — one sentence is worth keeping.
          </Empty>
        ) : (
          <div className="space-y-3">
            {written.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                mine={memory.authorContactId === contactId}
                onToggleShare={() =>
                  update.mutate({
                    memoryId: memory.id,
                    data: { forOfficiant: !memory.forOfficiant },
                  })
                }
                onDelete={() => remove.mutate({ memoryId: memory.id })}
              />
            ))}
          </div>
        )}
      </section>

      {/*
        What was said, kept afterwards. Only ever shown once there is
        something in it — an empty "what was said at the service" heading in
        front of a family whose funeral has not happened yet would be a cruel
        piece of furniture.
      */}
      {said.length > 0 && (
        <section className="space-y-3">
          <Divider label="What was said" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Kept for you, so it does not only exist on a sheet of paper
            somebody folded into a pocket.
          </p>
          {said.map((memory) => (
            <article
              key={memory.id}
              className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]"
            >
              <Quote
                className="mb-2 size-5 text-[var(--accent)]/50"
                strokeWidth={1.75}
                aria-hidden
              />
              <p className="whitespace-pre-line leading-relaxed">{memory.body}</p>
              {memory.authorName && (
                <p className="mt-3 text-sm text-muted-foreground">
                  — {memory.authorName}
                </p>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
