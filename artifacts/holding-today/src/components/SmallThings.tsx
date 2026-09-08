import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import {
  getGetKeepsakesQueryKey,
  useGetKeepsakes,
  useCreateKeepsake,
  useGetProfile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { fillPrompt, prompts, type Prompt } from "@/content/prompts";
import { isRelationship } from "@/content/relationships";

/**
 * One small question at a time.
 *
 * Deliberately a single question rather than a form of forty. A form is a
 * demand; one question with a skip button is an offer, and the thing being
 * asked for — what his laugh sounded like — is answerable in fifteen seconds
 * on a day when nothing else is.
 *
 * It never nags and never counts. There is no progress bar, because "you have
 * answered 3 of 43 questions about your dead child" is a sentence nobody
 * should be shown.
 */
export function SmallThings() {
  const { data: profile } = useGetProfile();
  const { data: answered, refetch } = useGetKeepsakes({
    query: { queryKey: getGetKeepsakesQueryKey() },
  });
  const { mutate: save, isPending } = useCreateKeepsake();

  const [answer, setAnswer] = useState("");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const name = profile?.childName?.trim() || null;
  const relationships = (profile?.relationships ?? []).filter(isRelationship);

  /** Questions not yet answered and not skipped this sitting. */
  const remaining = useMemo(() => {
    const done = new Set((answered ?? []).map((k) => k.promptId));
    return prompts.filter((prompt) => {
      if (done.has(prompt.id) || skipped.includes(prompt.id)) return false;
      // A prompt written for one kind of loss is only offered to that reader.
      // Unlike the guides, an unanswerable question is not worth showing:
      // "what was their first word" to a widow is just a small wound.
      if (!prompt.relationships) return true;
      if (relationships.length === 0) return false;
      return prompt.relationships.some((r) => relationships.includes(r));
    });
  }, [answered, skipped, relationships]);

  // Stable per render-set so it does not flicker between keystrokes.
  const current: Prompt | undefined = remaining[0];

  if (!current) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {answered?.length
            ? "You have answered all of these. They are kept on the profile page, and they turn up again in the things you have written."
            : "Nothing to ask just now."}
        </p>
      </div>
    );
  }

  const question = fillPrompt(current.question, name);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!answer.trim()) return;
    save(
      { data: { promptId: current.id, question, answer: answer.trim() } },
      {
        onSuccess: () => {
          setAnswer("");
          setJustSaved(true);
          window.setTimeout(() => setJustSaved(false), 1800);
          refetch();
        },
      },
    );
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-5 md:p-6"
      aria-label="A small thing to write down"
    >
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-primary/70" />
        <h2 className="text-sm uppercase tracking-[0.16em] text-primary/60">
          One small thing
        </h2>
      </div>

      <p className="font-display text-lg md:text-xl text-foreground mb-1.5">
        {question}
      </p>
      {current.hint && (
        <p className="text-sm text-muted-foreground/80 mb-4">{current.hint}</p>
      )}

      <form onSubmit={submit} className="mt-4">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="A few words is enough."
          className="w-full bg-background border border-white/10 rounded-xl p-3 text-foreground min-h-[80px] resize-y"
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button
            type="submit"
            disabled={isPending || !answer.trim()}
            className="bg-primary text-primary-foreground"
          >
            {justSaved ? (
              <>
                <Check className="w-4 h-4 mr-2" /> Kept
              </>
            ) : (
              "Keep it"
            )}
          </Button>
          <button
            type="button"
            onClick={() => {
              setSkipped((s) => [...s, current.id]);
              setAnswer("");
            }}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Ask me a different one
          </button>
        </div>
      </form>

      <p className="text-xs text-muted-foreground/60 leading-relaxed mt-4">
        Nothing here is required and nothing is counted. Skip as many as you
        like — they come back around.
      </p>
    </motion.section>
  );
}
