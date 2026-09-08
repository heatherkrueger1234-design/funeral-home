import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useGetProfile, useUpdateProfile } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { RELATIONSHIPS, type Relationship } from "@/content/relationships";
import { cn } from "@/lib/utils";

/**
 * "Who are you here for?", asked once, gently, and never as a gate.
 *
 * Deliberately not part of the first-run screen. That screen asks for one
 * thing — their name — and adding a second required question to the worst
 * week of somebody's life is a demand, not an onboarding step. This card
 * appears on the home page afterwards and can be dismissed forever without
 * answering.
 *
 * Multi-select, because grief is layered. The person who built this site lost
 * a son, her mother, her father, her grandparents, a baby and her best friend;
 * a radio button would have shut her out of most of what she needed.
 */

const DISMISSED_KEY = "holding-today:relationship-prompt-dismissed";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Private windows and blocked site data both throw here. Showing the card
    // is the safe failure: it is skippable either way.
    return false;
  }
}

export function WhoAreYouHereFor() {
  const { data: profile, refetch } = useGetProfile();
  const { mutate: updateProfile, isPending } = useUpdateProfile();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [picked, setPicked] = useState<Relationship[]>([]);

  // Already answered, or told to go away.
  if (dismissed || (profile?.relationships?.length ?? 0) > 0) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to recover from — it just asks again next time.
    }
    setDismissed(true);
  };

  const toggle = (value: Relationship) =>
    setPicked((current) =>
      current.includes(value)
        ? current.filter((r) => r !== value)
        : [...current, value],
    );

  const save = () => {
    if (picked.length === 0) return;
    updateProfile(
      { data: { relationships: picked } },
      {
        onSuccess: () => {
          refetch();
          setDismissed(true);
        },
      },
    );
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-5 md:p-6 mb-10 border border-primary/20 relative"
      aria-label="Who are you here for"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="absolute top-4 right-4 text-muted-foreground/40 hover:text-foreground transition-colors p-1"
      >
        <X className="w-4 h-4" />
      </button>

      <h2 className="font-display text-xl text-foreground mb-2 pr-8">
        Who are you here for?
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-2xl">
        It changes which parts of the guides come first — nothing is ever hidden
        from you, and you can pick more than one. Plenty of people here are
        carrying several at once.
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {RELATIONSHIPS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            aria-pressed={picked.includes(option.value)}
            className={cn(
              "px-3.5 py-2 rounded-full text-sm border transition-colors",
              picked.includes(option.value)
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={save}
          disabled={isPending || picked.length === 0}
          className="bg-primary text-primary-foreground"
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip this
        </button>
      </div>
    </motion.section>
  );
}
