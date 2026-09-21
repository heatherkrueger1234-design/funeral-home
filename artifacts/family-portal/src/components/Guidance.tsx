import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * "How do I even start?", answered without getting in the way.
 *
 * Every screen in this portal is read by somebody who did not choose to be
 * here and was not trained on it, and two of them — the obituary and the
 * memories — ask for writing rather than for facts. A blank box is where that
 * stalls, and "write about their life" is not a prompt, it is a cliff.
 *
 * So the help is on the page rather than in a support article nobody opens,
 * and it is closed by default: a family member who already knows what they
 * want to say should not have to scroll past a lecture to say it, and one who
 * does not should find it in the one place they are already looking.
 *
 * A `<details>` element rather than state and a chevron we animate ourselves.
 * It works before React has hydrated, it is what a screen reader already
 * understands, and the browser's own find-in-page opens it to show a match.
 *
 * What goes inside is guidance, never prose to copy. That is the same line
 * `schema/print.ts` draws about verses and it holds for the same reason
 * turned inside out: a card verse is somebody's copyright, and a paragraph of
 * ready-made obituary is worse than copyright — it is a stranger's sentences
 * about somebody's mother, at the one moment when only the family's own
 * words are worth anything.
 */
export function Guidance({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-[var(--sunken)] open:bg-card open:shadow-[var(--elevation-1)]">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold
                   text-[var(--accent-deep)] [&::-webkit-details-marker]:hidden"
      >
        <ChevronDown
          className="size-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)] group-open:rotate-180"
          strokeWidth={2}
          aria-hidden
        />
        {title}
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/** A point in a piece of guidance: the short version, then why. */
export function Point({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <p>
      <strong className="font-semibold text-foreground">{lead}</strong>{" "}
      {children}
    </p>
  );
}
