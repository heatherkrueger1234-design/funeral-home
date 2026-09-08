import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Clock, Scale, AlertTriangle, Check, Plus } from "lucide-react";
import { useCreateTodo, useGetProfile } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import type { Block, Chapter, ChapterGroup } from "@/content/types";
import { relevanceRank, writtenForLabel } from "@/content/relationships";

/**
 * Renders the written guides.
 *
 * Chapters start collapsed, showing their title and one line of what they are
 * about. Thirty chapters laid out in full is a wall, and some of them — the
 * one about what a body looks like, the one about the autopsy report — are
 * things a reader should open deliberately rather than scroll into by
 * accident. The summary line is there so nobody has to open a chapter to find
 * out whether they can face it.
 *
 * A chapter linked to directly (#autopsy) opens itself and scrolls to itself,
 * because a link someone was sent should land on the thing, not near it.
 */

/**
 * One line of a checklist, with a way to put it on the reader's own to-do list.
 *
 * The chapter about the things that close fast is the most time-critical page
 * on the site, and reading it is not the same as doing it. This is the shortest
 * path from "somebody should keep a lock of his hair" to a task that will still
 * be there tomorrow, when the reader has no memory of today.
 *
 * It reuses the existing to-do list rather than adding a second place where
 * tasks live. Signed out, the button is simply not offered — the guides work
 * without an account and must not start demanding one.
 */
function ChecklistItem({ text, deadline }: { text: string; deadline: string }) {
  const { user } = useSession();
  const { mutate: createTodo, isPending } = useCreateTodo();
  const { toast } = useToast();
  const [added, setAdded] = useState(false);

  const add = () => {
    createTodo(
      {
        data: {
          // The deadline is part of the task: without it this is just a chore,
          // and the whole point of these is that the window closes.
          text: `${text} (${deadline})`,
          completed: false,
          category: "First days",
        },
      },
      {
        onSuccess: () => {
          setAdded(true);
          toast({
            title: "On your to-do list",
            description: "It will be there when you are ready.",
          });
        },
      },
    );
  };

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-foreground/85 leading-relaxed">{text}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-200/80">
            <Clock className="w-3 h-3 flex-shrink-0" />
            {deadline}
          </p>
        </div>

        {user && (
          <button
            type="button"
            onClick={add}
            disabled={isPending || added}
            aria-label={added ? "Added to your to-do list" : "Add to my to-do list"}
            className={cn(
              "flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
              added
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-white/15 text-muted-foreground hover:bg-white/10 hover:text-foreground",
            )}
          >
            {added ? (
              <>
                <Check className="w-3 h-3" /> Added
              </>
            ) : (
              <>
                <Plus className="w-3 h-3" /> To-do
              </>
            )}
          </button>
        )}
      </div>
    </li>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p className="text-foreground/80 leading-relaxed">{block.text}</p>;

    case "heading":
      return (
        <h3 className="font-display text-lg text-foreground/95 pt-2">
          {block.text}
        </h3>
      );

    case "list":
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-foreground/80 leading-relaxed">
              <span className="text-primary/50 select-none flex-shrink-0">—</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "checklist":
      return (
        <ul className="space-y-2.5">
          {block.items.map((item, i) => (
            <ChecklistItem key={i} text={item.text} deadline={item.deadline} />
          ))}
        </ul>
      );

    case "law":
      return (
        <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.07] px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-sky-200/80 mb-1.5">
            <Scale className="w-3 h-3 flex-shrink-0" />
            {block.state}
          </p>
          <p className="text-foreground/80 leading-relaxed">{block.text}</p>
        </div>
      );

    case "warn":
      return (
        <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.07] px-4 py-3">
          <p className="flex gap-2.5 text-foreground/80 leading-relaxed">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-300/80 mt-0.5" />
            <span>{block.text}</span>
          </p>
        </div>
      );

    case "note":
      return (
        <p className="border-l-2 border-primary/30 pl-4 text-foreground/70 leading-relaxed italic">
          {block.text}
        </p>
      );

  }
}

function ChapterCard({
  chapter,
  defaultOpen,
  showWrittenFor,
}: {
  chapter: Chapter;
  defaultOpen: boolean;
  /**
   * Set when this chapter was written for a different loss than the reader's.
   * It is a label, never a lock — somebody who lost a partner may well want
   * the chapter on siblings, and grief does not sort cleanly anyway.
   */
  showWrittenFor?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // A link to #autopsy should open the autopsy chapter, not leave the reader
  // staring at a collapsed row wondering where the thing they were sent went.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <div
      id={chapter.id}
      className="glass-panel rounded-2xl border border-white/10 overflow-hidden scroll-mt-24"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full text-left px-5 py-4 md:px-6 md:py-5 flex items-start gap-4 hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg md:text-xl text-foreground">
            {chapter.title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            {chapter.summary}
          </p>
          {showWrittenFor && (
            <p className="text-xs text-muted-foreground/50 mt-2">
              {showWrittenFor}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-5 h-5 flex-shrink-0 text-muted-foreground/60 transition-transform duration-200 mt-1",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 md:px-6 md:pb-7 space-y-4 border-t border-white/5 pt-5">
              {chapter.body.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChapterGroups({ groups }: { groups: ChapterGroup[] }) {
  const { data: profile } = useGetProfile();
  const reader = profile?.relationships ?? undefined;

  // Read once on mount rather than watching the hash: this only needs to
  // answer "was this page opened at a particular chapter".
  const [target] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""),
  );

  useEffect(() => {
    if (!target) return;
    // After the chapter has had a frame to expand.
    const timer = window.setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.heading}>
          <h2 className="font-display text-sm uppercase tracking-[0.16em] text-muted-foreground/60 mb-1">
            {group.heading}
          </h2>
          {group.blurb && (
            <p className="text-sm text-muted-foreground/80 leading-relaxed mb-4 max-w-2xl">
              {group.blurb}
            </p>
          )}
          <div className={cn("space-y-3", !group.blurb && "mt-4")}>
            {/*
              Sorted, not filtered. A chapter written for another kind of loss
              moves to the end of its group and says who it was written for;
              it is never taken away. Stable within a rank, so the authored
              order survives for a reader who has said nothing.
            */}
            {group.chapters
              .map((chapter, index) => ({
                chapter,
                index,
                rank: relevanceRank(chapter.relationships, reader),
              }))
              .sort((a, b) => a.rank - b.rank || a.index - b.index)
              .map(({ chapter, rank }) => (
                <ChapterCard
                  key={chapter.id}
                  chapter={chapter}
                  defaultOpen={chapter.id === target}
                  showWrittenFor={
                    rank === 2 ? writtenForLabel(chapter.relationships ?? []) : null
                  }
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
