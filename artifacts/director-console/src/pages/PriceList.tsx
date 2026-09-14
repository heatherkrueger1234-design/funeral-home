import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPriceList,
  useCreatePriceItem,
  useUpdatePriceItem,
  useDeletePriceItem,
  getGetPriceListQueryKey,
} from "@workspace/api-client-react";
import type { PriceItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Empty, Loading, PageHeader, Panel, Divider } from "@/components/page";
import { Lock, Plus, Tag, Trash2 } from "lucide-react";

/**
 * The home's own prices, on the screen the director already has open.
 *
 * This is a crib sheet, not a quote and not a price list in the sense the law
 * means. A director arranging at a kitchen table gets asked what a graveside
 * service costs and currently answers by ringing the office or remembering;
 * this is the answer, in their own words and their own categories.
 *
 * The banner at the top is not decoration. A screen full of a funeral home's
 * prices, inside software the family also uses, is exactly the screen someone
 * would assume the family can see — and a director who assumed wrongly would
 * be making a Funeral Rule problem for themselves in front of a customer. So
 * it says plainly, every time, that nobody outside the office can reach this.
 */

/** "2495" or "2,495.00" typed by a person, to cents. Null when they meant nothing. */
function toCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}

export default function PriceList() {
  const queryClient = useQueryClient();
  const list = useGetPriceList();

  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetPriceListQueryKey() });

  const add = useCreatePriceItem({
    mutation: {
      onSuccess: () => {
        setLabel("");
        setAmount("");
        refresh();
      },
    },
  });

  if (list.isPending) return <Loading rows={4} />;

  const rows = list.data ?? [];

  /* The home's own categories, in the order the server sorted them. */
  const categories: string[] = [];
  for (const row of rows) {
    if (!categories.includes(row.category)) categories.push(row.category);
  }

  const newCategory = category.trim() || categories[0] || "Services";
  const newLabel = label.trim();

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Prices">
        What you charge, so whoever is sitting with a family can answer
        without ringing the office.
      </PageHeader>

      <p className="flex items-start gap-2.5 rounded-xl border border-border
                    bg-[var(--sunken)] p-5 text-sm">
        <Lock className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
        <span>
          <span className="block font-medium">Only your staff can see this</span>
          <span className="block text-muted-foreground mt-0.5">
            Nothing here reaches a family&rsquo;s portal or your public page,
            and there is no setting that would let it. The FTC Funeral Rule
            governs how prices are disclosed, and that belongs in your own
            price list handed over in person — not in software.
          </span>
        </span>
      </p>

      {categories.map((name) => (
        <section key={name} className="space-y-2">
          <Divider label={name} />
          <ul className="space-y-2">
            {rows
              .filter((row) => row.category === name)
              .map((row) => (
                <PriceRow key={row.id} row={row} onChanged={refresh} />
              ))}
          </ul>
        </section>
      ))}

      {rows.length === 0 && (
        <Empty icon={Tag} title="Nothing on the sheet yet">
          Add the handful you get asked about most. It does not have to be
          everything.
        </Empty>
      )}

      <Panel className="space-y-3">
        <h2 className="font-display text-lg">Add a line</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="category">Heading</Label>
            <Input
              id="category"
              list="price-categories"
              value={category}
              placeholder={categories[0] ?? "Services"}
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id="price-categories">
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="label">What it is</Label>
            <Input
              id="label"
              value={label}
              placeholder="Graveside service"
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amount">Price</Label>
            <Input
              id="amount"
              inputMode="decimal"
              className="sm:w-28"
              value={amount}
              placeholder="2495"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
        </div>
        <p className="text-sm leading-snug text-muted-foreground">
          Leave the price blank for anything that genuinely has no number —
          flowers at market, a cemetery&rsquo;s own fee — and say so in the
          note on the line.
        </p>
        <Button
          variant="outline"
          disabled={!newLabel || add.isPending}
          onClick={() =>
            add.mutate({
              data: {
                category: newCategory,
                label: newLabel,
                amountCents: toCents(amount),
              },
            })
          }
        >
          <Plus className="size-4" />
          Add
        </Button>
      </Panel>
    </div>
  );
}

function PriceRow({ row, onChanged }: { row: PriceItem; onChanged: () => void }) {
  const update = useUpdatePriceItem({ mutation: { onSuccess: onChanged } });
  const remove = useDeletePriceItem({ mutation: { onSuccess: onChanged } });

  return (
    <li
      className={`rounded-xl border p-3 ${
        row.enabled
          ? "border-border bg-card"
          : "border-dashed border-border bg-[var(--sunken)] opacity-70"
      }`}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
        <Input
          defaultValue={row.label}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== row.label) {
              update.mutate({ itemId: row.id, data: { label: value } });
            }
          }}
        />
        <Input
          inputMode="decimal"
          className="sm:w-32 text-right tabular-nums"
          defaultValue={
            row.amountCents === null ? "" : (row.amountCents / 100).toFixed(2)
          }
          placeholder="—"
          onBlur={(event) => {
            const cents = toCents(event.target.value);
            if (cents !== row.amountCents) {
              update.mutate({ itemId: row.id, data: { amountCents: cents } });
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove ${row.label}`}
          onClick={() => remove.mutate({ itemId: row.id })}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Input
          className="flex-1 min-w-48 h-8 text-sm"
          defaultValue={row.note ?? ""}
          placeholder="Note — “plus cemetery charges”, “per day”, “from”"
          onBlur={(event) => {
            const value = event.target.value.trim() || null;
            if (value !== row.note) {
              update.mutate({ itemId: row.id, data: { note: value } });
            }
          }}
        />
        {/*
          Off rather than deleted. A home stops offering things, and a deleted
          row takes with it the last record of what was charged in the year
          somebody is now asking about.
        */}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={row.enabled}
            onCheckedChange={(checked) =>
              update.mutate({ itemId: row.id, data: { enabled: checked } })
            }
          />
          {row.enabled ? "On the sheet" : "Retired"}
        </label>
      </div>
    </li>
  );
}
