import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  catalogueQueryKey,
  createPackage,
  deletePackage,
  formatPrice,
  type Catalogue,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

/**
 * Packages, which exist in addition and never instead.
 *
 * The Funeral Rule permits a home to offer a set at a set price and forbids
 * selling only that way. So a package here is a shortcut, not a product:
 * choosing one writes its items onto the family's sheet at their own
 * itemised prices, with one adjustment line carrying the saving. Decline any
 * one of them and the item goes, the adjustment goes, and everything left
 * stands at its own price — which is what a director would say across a desk
 * and what the Rule requires the software to make possible.
 *
 * The itemised total is shown beside the package price everywhere, including
 * here, so a director can see at a glance what they are actually offering.
 */

function parseDollars(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

export function PackagesPanel({ catalogue }: { catalogue: Catalogue }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: catalogueQueryKey });

  const allItems = catalogue.categories.flatMap((category) =>
    category.items.map((item) => ({ ...item, categoryName: category.name })),
  );

  const cents = parseDollars(price);
  const itemised = chosen.reduce(
    (total, id) => total + (allItems.find((item) => item.id === id)?.priceCents ?? 0),
    0,
  );
  const ready = name.trim() !== "" && cents !== null && chosen.length > 0;

  async function add() {
    if (!ready) return;
    setBusy(true);
    try {
      await createPackage({ name: name.trim(), priceCents: cents, itemIds: chosen });
      setName("");
      setPrice("");
      setChosen([]);
      refresh();
    } catch (error) {
      toast({
        title: "That didn't save",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  if (allItems.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="font-display text-xl mb-1">Items first</h2>
        <p className="mx-auto max-w-prose text-muted-foreground">
          A package is a set of things you already sell, offered together at a
          price of your own. Load your catalogue and they'll be here to pick
          from.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {catalogue.packages.length > 0 && (
        <ul className="space-y-3">
          {catalogue.packages.map((pack) => (
            <li key={pack.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="font-medium">{pack.name}</h2>
                <span className="tabular-nums">{formatPrice(pack.priceCents)}</span>
                <span className="text-sm text-muted-foreground">
                  {formatPrice(pack.itemisedTotalCents)} bought separately
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  onClick={async () => {
                    await deletePackage(pack.id);
                    refresh();
                  }}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                {pack.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4">
                    <span>{item.name}</span>
                    <span className="tabular-nums">{formatPrice(item.priceCents)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-medium">Offer a package</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Families always see every item's own price as well, and can decline
            any one of them — that is what keeps a package lawful to offer.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="package-name">Name</Label>
            <Input
              id="package-name"
              placeholder="Traditional Service"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="package-price">Package price</Label>
            <Input
              id="package-price"
              inputMode="decimal"
              placeholder="0.00"
              className="text-right tabular-nums"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {allItems.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={chosen.includes(item.id)}
                    onCheckedChange={(checked) =>
                      setChosen((current) =>
                        checked === true
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    {item.name}
                    <span className="ml-2 text-muted-foreground">
                      {item.categoryName}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatPrice(item.priceCents)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {chosen.length === 0
              ? "Choose what goes in it."
              : `${chosen.length} item${chosen.length === 1 ? "" : "s"} · ${formatPrice(itemised)} bought separately`}
          </p>
          <Button className="ml-auto" disabled={!ready || busy} onClick={() => void add()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Offer this package
          </Button>
        </div>
      </section>
    </div>
  );
}
