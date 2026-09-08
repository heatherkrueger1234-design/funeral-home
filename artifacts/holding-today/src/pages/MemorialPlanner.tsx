import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Church, Plus, Trash2 } from "lucide-react";
import {
  useGetMemorialChoices,
  useCreateMemorialChoice,
  useUpdateMemorialChoice,
  useDeleteMemorialChoice,
  type MemorialChoice,
  type MemorialChoiceInputStatus,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The memorial as a list of decisions rather than a form.
 *
 * Two things this does that a funeral home's paperwork does not. It lets a
 * choice be *declined* — "no headstone" and "no grave" are real answers, and a
 * form with a headstone field cannot express them. And it shows the running
 * total, because funeral costs are quoted item by item precisely so that the
 * sum is not visible until it is being signed for.
 */

const CATEGORIES = [
  { value: "venue", label: "Venue" },
  { value: "song", label: "Songs" },
  { value: "poem", label: "Poems" },
  { value: "reading", label: "Readings" },
  { value: "speaker", label: "Who speaks" },
  { value: "casket", label: "Casket or urn" },
  { value: "headstone", label: "Headstone" },
  { value: "grave", label: "Grave or scattering" },
  { value: "jewelry", label: "Jewellery and keepsakes" },
  { value: "flowers", label: "Flowers" },
  { value: "transport", label: "Transport" },
  { value: "program", label: "Programme" },
  { value: "food", label: "Food afterwards" },
  { value: "other", label: "Anything else" },
] as const;

const STATUSES = [
  { value: "undecided", label: "Undecided", tone: "border-white/15 text-muted-foreground bg-white/5" },
  { value: "chosen", label: "Chosen", tone: "border-sky-400/30 text-sky-200 bg-sky-400/10" },
  { value: "declined", label: "Not doing this", tone: "border-rose-400/30 text-rose-200 bg-rose-400/10" },
  { value: "done", label: "Done", tone: "border-emerald-400/30 text-emerald-200 bg-emerald-400/10" },
] as const;

const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export default function MemorialPlanner() {
  const { data: choices, refetch } = useGetMemorialChoices();
  const { mutate: create, isPending } = useCreateMemorialChoice();
  const { mutate: update } = useUpdateMemorialChoice();
  const { mutate: remove } = useDeleteMemorialChoice();

  const [title, setTitle] = useState("");
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]["value"]>("song");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    create(
      { data: { category, title: title.trim() } },
      {
        onSuccess: () => {
          setTitle("");
          refetch();
        },
      },
    );
  };

  const setStatus = (choice: MemorialChoice, status: MemorialChoiceInputStatus) =>
    update({ id: choice.id, data: { status } }, { onSuccess: () => refetch() });

  const setCost = (choice: MemorialChoice, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      update({ id: choice.id, data: { estimatedCost: null } }, { onSuccess: () => refetch() });
      return;
    }
    const dollars = Number(trimmed.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(dollars)) return;
    update(
      { id: choice.id, data: { estimatedCost: Math.round(dollars * 100) } },
      { onSuccess: () => refetch() },
    );
  };

  const { total, counted, undecided } = useMemo(() => {
    // A declined choice costs nothing, and counting it would make the total a
    // lie in the direction that matters.
    const live = (choices ?? []).filter((c) => c.status !== "declined");
    return {
      total: live.reduce((sum, c) => sum + (c.estimatedCost ?? 0), 0),
      counted: live.filter((c) => c.estimatedCost != null).length,
      undecided: (choices ?? []).filter((c) => c.status === "undecided").length,
    };
  }, [choices]);

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: (choices ?? []).filter((c) => c.category === cat.value),
    })).filter((group) => group.items.length > 0);
  }, [choices]);

  return (
    <PageLayout>
      <PageHeader
        title="The memorial"
        description="Every choice, including the ones you decide not to make."
      />

      <form
        onSubmit={add}
        className="glass-panel p-4 rounded-2xl flex flex-wrap gap-3 mb-6"
      >
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as (typeof CATEGORIES)[number]["value"])
          }
          className="bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="The song he played constantly"
          className="flex-1 bg-background border-white/10 min-w-[12rem]"
        />
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary text-primary-foreground px-5"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {choices && choices.length > 0 && (
        <div className="glass-panel rounded-2xl p-5 mb-8 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground/60 mb-1">
              Estimated so far
            </p>
            <p className="font-display text-2xl text-foreground">
              {money(total)}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              from {counted} {counted === 1 ? "item" : "items"} with a price on
              them
            </p>
          </div>
          {undecided > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground/60 mb-1">
                Still open
              </p>
              <p className="font-display text-2xl text-foreground">{undecided}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground/80 leading-relaxed flex-1 min-w-[14rem]">
            Nothing here is a quote and nothing is committed. It is a total so
            that you can see one, which is more than the itemised paperwork will
            give you.
          </p>
        </div>
      )}

      {!choices?.length ? (
        <EmptyState
          icon={Church}
          title="Nothing decided yet"
          description="Add the choices as they come up — a song, a venue, whether there is a headstone at all. You can mark any of them 'not doing this', which is a real answer."
        />
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <section key={group.value}>
              <h3 className="text-primary/70 uppercase tracking-widest text-xs font-semibold mb-3">
                {group.label}
              </h3>
              <div className="space-y-3">
                {group.items.map((choice) => (
                  <motion.div
                    key={choice.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="glass-panel px-5 py-4 rounded-2xl group"
                  >
                    <div className="flex items-start gap-4">
                      <p
                        className={cn(
                          "flex-1 break-words",
                          choice.status === "declined"
                            ? "text-muted-foreground line-through"
                            : "text-foreground",
                        )}
                      >
                        {choice.title}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all flex-shrink-0"
                        onClick={() =>
                          remove({ id: choice.id }, { onSuccess: () => refetch() })
                        }
                        aria-label={`Remove ${choice.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      {STATUSES.map((status) => (
                        <button
                          key={status.value}
                          type="button"
                          onClick={() => setStatus(choice, status.value)}
                          className={cn(
                            "px-2.5 py-1 rounded-full text-xs border transition-colors",
                            choice.status === status.value
                              ? status.tone
                              : "border-white/10 text-muted-foreground/60 hover:bg-white/5",
                          )}
                        >
                          {status.label}
                        </button>
                      ))}

                      {choice.status !== "declined" && (
                        <Input
                          defaultValue={
                            choice.estimatedCost != null
                              ? String(choice.estimatedCost / 100)
                              : ""
                          }
                          onBlur={(e) => setCost(choice, e.target.value)}
                          placeholder="Cost"
                          inputMode="decimal"
                          aria-label={`Estimated cost for ${choice.title}`}
                          className="bg-background/60 border-white/10 h-7 text-xs w-24 ml-auto"
                        />
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
