import { useState } from "react";
import { motion } from "framer-motion";
import {
  Package,
  Plus,
  Trash2,
  Check,
  Gift as GiftIcon,
  Mail,
} from "lucide-react";
import {
  useGetBelongings,
  useCreateBelonging,
  useUpdateBelonging,
  useDeleteBelonging,
  useGetGifts,
  useCreateGift,
  useUpdateGift,
  useDeleteGift,
  type Belonging,
  type BelongingInputStatus,
  type Gift,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Two lists that are really one problem: things leaving the house, and things
 * arriving at it.
 *
 * Nothing here reminds, nags, or counts down. A thank-you tracker that tells a
 * bereaved parent they are behind on their correspondence would be a cruelty.
 * It only remembers, so that three at a time is possible and the rest can wait
 * indefinitely without being lost.
 */

const BELONGING_STATUSES = [
  { value: "kept", label: "Still here", tone: "border-white/15 text-muted-foreground bg-white/5" },
  { value: "requested", label: "Someone asked", tone: "border-amber-400/30 text-amber-200 bg-amber-400/10" },
  { value: "promised", label: "Promised", tone: "border-sky-400/30 text-sky-200 bg-sky-400/10" },
  { value: "given", label: "Given", tone: "border-emerald-400/30 text-emerald-200 bg-emerald-400/10" },
] as const;

const GIFT_KINDS = [
  "flowers", "food", "money", "card", "donation", "gift", "help", "other",
] as const;

function statusTone(status: string) {
  return (
    BELONGING_STATUSES.find((s) => s.value === status) ?? BELONGING_STATUSES[0]
  );
}

function BelongingsTab() {
  const { data: items, refetch } = useGetBelongings();
  const { mutate: create, isPending } = useCreateBelonging();
  const { mutate: update } = useUpdateBelonging();
  const { mutate: remove } = useDeleteBelonging();

  const [item, setItem] = useState("");
  const [person, setPerson] = useState("");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!item.trim()) return;
    create(
      {
        data: {
          item: item.trim(),
          person: person.trim() || null,
          // Naming a person up front almost always means they have asked for
          // it, not that it has already gone.
          status: person.trim() ? "requested" : "kept",
        },
      },
      {
        onSuccess: () => {
          setItem("");
          setPerson("");
          refetch();
        },
      },
    );
  };

  const setStatus = (row: Belonging, status: BelongingInputStatus) => {
    update(
      {
        id: row.id,
        data: {
          status,
          givenDate:
            status === "given"
              ? row.givenDate ?? new Date().toISOString().slice(0, 10)
              : row.givenDate,
        },
      },
      { onSuccess: () => refetch() },
    );
  };

  return (
    <div>
      <form
        onSubmit={add}
        className="glass-panel p-4 rounded-2xl flex flex-wrap gap-3 mb-8"
      >
        <Input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="His leather jacket"
          className="flex-1 bg-background border-white/10 min-w-[12rem]"
        />
        <Input
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="Who has it, or who asked (optional)"
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

      {!items?.length ? (
        <EmptyState
          icon={Package}
          title="Nothing written down yet"
          description="What they had, and where it went. Add things as they are asked for — you will not remember in a year, and people do ask."
        />
      ) : (
        <div className="space-y-3">
          {items.map((row, i) => {
            const tone = statusTone(row.status);
            return (
              <motion.div
                key={row.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className="glass-panel px-5 py-4 rounded-2xl group"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground break-words">{row.item}</p>
                    {row.person && (
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {row.status === "given" ? "With" : "Asked for by"}{" "}
                        <span className="text-foreground/80">{row.person}</span>
                        {row.givenDate && row.status === "given" && (
                          <span className="text-muted-foreground/60">
                            {" "}· {row.givenDate}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all flex-shrink-0"
                    onClick={() => remove({ id: row.id }, { onSuccess: () => refetch() })}
                    aria-label={`Remove ${row.item}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {BELONGING_STATUSES.map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      onClick={() => setStatus(row, status.value)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-xs border transition-colors",
                        row.status === status.value
                          ? status.tone
                          : "border-white/10 text-muted-foreground/60 hover:bg-white/5",
                      )}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GiftsTab() {
  const { data: gifts, refetch } = useGetGifts();
  const { mutate: create, isPending } = useCreateGift();
  const { mutate: update } = useUpdateGift();
  const { mutate: remove } = useDeleteGift();

  const [fromName, setFromName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<(typeof GIFT_KINDS)[number]>("food");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!fromName.trim()) return;
    create(
      {
        data: {
          fromName: fromName.trim(),
          kind,
          description: description.trim() || null,
          receivedDate: new Date().toISOString().slice(0, 10),
        },
      },
      {
        onSuccess: () => {
          setFromName("");
          setDescription("");
          refetch();
        },
      },
    );
  };

  const toggleThanked = (gift: Gift) => {
    update(
      { id: gift.id, data: { thanked: !gift.thanked } },
      { onSuccess: () => refetch() },
    );
  };

  const outstanding = gifts?.filter((g) => !g.thanked) ?? [];
  const done = gifts?.filter((g) => g.thanked) ?? [];

  const render = (gift: Gift) => (
    <motion.div
      key={gift.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-panel px-5 py-4 rounded-2xl flex items-center gap-4 group"
    >
      <button
        onClick={() => toggleThanked(gift)}
        aria-label={gift.thanked ? "Mark card as not sent" : "Mark card as sent"}
        className={cn(
          "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
          gift.thanked
            ? "bg-primary/30 border-primary"
            : "border-primary/40 hover:border-primary",
        )}
      >
        {gift.thanked && <Check className="w-3 h-3 text-primary" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn("break-words", gift.thanked ? "text-muted-foreground" : "text-foreground")}>
          {gift.fromName}
        </p>
        <p className="text-sm text-muted-foreground/70">
          <span className="capitalize">{gift.kind}</span>
          {gift.description && ` · ${gift.description}`}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all flex-shrink-0"
        onClick={() => remove({ id: gift.id }, { onSuccess: () => refetch() })}
        aria-label={`Remove ${gift.fromName}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </motion.div>
  );

  return (
    <div>
      <form
        onSubmit={add}
        className="glass-panel p-4 rounded-2xl flex flex-wrap gap-3 mb-8"
      >
        <Input
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
          placeholder="Who it came from"
          className="flex-1 bg-background border-white/10 min-w-[10rem]"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Lasagne, glass dish with a blue lid"
          className="flex-1 bg-background border-white/10 min-w-[10rem]"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof GIFT_KINDS)[number])}
          className="bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground capitalize"
        >
          {GIFT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary text-primary-foreground px-5"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {!gifts?.length ? (
        <EmptyState
          icon={GiftIcon}
          title="Nothing written down yet"
          description="Flowers, food, money, someone who mowed the lawn. Write them down as they arrive — in a month you will not be able to reconstruct it, and the dishes need returning."
        />
      ) : (
        <div className="space-y-8">
          {outstanding.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-primary/70 uppercase tracking-widest text-xs font-semibold flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" />
                No card sent yet ({outstanding.length})
              </h3>
              {outstanding.map(render)}
            </div>
          )}

          {done.length > 0 && (
            <div className="space-y-3 opacity-60">
              <h3 className="text-muted-foreground uppercase tracking-widest text-xs font-semibold">
                Thanked ({done.length})
              </h3>
              {done.map(render)}
            </div>
          )}

          {outstanding.length > 0 && (
            <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-xl">
              There is no deadline on any of these. People who send food to a
              grieving family are not waiting on a card, whatever it feels like
              at three in the morning.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Belongings() {
  return (
    <PageLayout>
      <PageHeader
        title="Their things, and everyone else's"
        description="Where their belongings went, and what arrived at the door."
      />

      <Tabs defaultValue="belongings">
        <TabsList className="mb-6 bg-white/5">
          <TabsTrigger value="belongings">Their things</TabsTrigger>
          <TabsTrigger value="gifts">What people sent</TabsTrigger>
        </TabsList>

        <TabsContent value="belongings">
          <BelongingsTab />
        </TabsContent>
        <TabsContent value="gifts">
          <GiftsTab />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
