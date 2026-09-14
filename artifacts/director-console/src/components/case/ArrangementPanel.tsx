import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  addFamilyProvidedItem,
  addSelectionItem,
  addSelectionPackage,
  getGetCaseStorefrontQueryKey,
  formatPrice,
  recordGplGiven,
  removeSelectionLine,
  statementUrl,
  updateMerchandiseSelection,
  useGetCaseStorefront,
  SECTION_LABELS,
  type CatalogueSection,
  type MerchandiseSelectionLine,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Lock, Plus, Printer, Trash2 } from "lucide-react";

/**
 * The arrangement, from the director's side of the desk.
 *
 * Everything the family can do here, a director can do with them on the
 * telephone — which is the point, because most of these conversations still
 * happen on a telephone. What the director has that the family does not is
 * the two decisions that turn a draft into a document: recording that the
 * General Price List has been handed over, and agreeing the arrangement.
 *
 * Nothing on this screen says a family has paid. We process nothing, so we
 * know nothing; the settled note is a director reading their own books, and
 * the copy says so in those words.
 */

export function ArrangementPanel({
  caseId,
  isPreNeed,
}: {
  caseId: number;
  isPreNeed: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const storefront = useGetCaseStorefront(caseId);

  const [busy, setBusy] = useState(false);
  const [broughtIn, setBroughtIn] = useState("");
  const [picking, setPicking] = useState<string>("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetCaseStorefrontQueryKey(caseId) });

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
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

  if (storefront.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const data = storefront.data;
  if (!data) return null;

  const { selection } = data;
  const confirmed = selection.status === "confirmed";
  const empty = selection.lines.length === 0;

  if (!data.hasGeneralPriceList) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="font-display text-xl mb-1">Your price list isn't ready</h2>
        <p className="mx-auto max-w-prose text-muted-foreground mb-4">
          A family is shown caskets only once your General Price List exists
          and they have it. Load your catalogue and give the list an effective
          date, and this becomes a working arrangement sheet.
        </p>
        <Button asChild variant="outline">
          <Link href="/catalogue">Set up your catalogue</Link>
        </Button>
      </div>
    );
  }

  const groups = new Map<string, MerchandiseSelectionLine[]>();
  for (const line of selection.lines) {
    const key =
      line.kind === "package_adjustment"
        ? "adjustment"
        : line.kind === "family_provided"
          ? "family_provided"
          : (line.section ?? "merchandise");
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  function labelFor(key: string): string {
    if (key === "adjustment") return "Package price";
    if (key === "family_provided") return "Bringing their own";
    return SECTION_LABELS[key as CatalogueSection] ?? "Other";
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-medium">
            {confirmed ? "Agreed" : "What they've chosen"}
          </h2>
          {selection.gplEffectiveOn && (
            <span className="text-sm text-muted-foreground">
              at the prices effective{" "}
              {new Date(selection.gplEffectiveOn).toLocaleDateString()}
            </span>
          )}
        </div>

        {empty ? (
          <p className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
            Nothing yet. Add what you talk through together, or leave it to the
            family to look at in their own time.
          </p>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            {[...groups.entries()].map(([key, lines]) => (
              <div key={key} className="border-b border-border last:border-b-0 p-4">
                <h3 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {labelFor(key)}
                </h3>
                <ul className="space-y-2">
                  {lines.map((line) => (
                    <li key={line.id} className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {line.name}
                          {line.quantity > 1 && (
                            <span className="ml-1.5 text-muted-foreground">
                              × {line.quantity}
                            </span>
                          )}
                        </p>
                        {line.notes && (
                          <p className="text-sm text-muted-foreground">
                            {line.notes}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {line.unitPriceCents === null ? (
                          <span className="text-muted-foreground">No charge</span>
                        ) : (
                          formatPrice(line.lineTotalCents)
                        )}
                      </span>
                      {!confirmed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Take ${line.name} off the list`}
                          disabled={busy || line.kind === "package_adjustment"}
                          onClick={() =>
                            void act(() => removeSelectionLine(caseId, line.id))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex items-baseline justify-between p-4 font-medium">
              <span>Total</span>
              <span className="tabular-nums text-lg">
                {formatPrice(selection.totalCents)}
              </span>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="selection-notes">On the statement, under the items</Label>
          <Textarea
            id="selection-notes"
            rows={2}
            placeholder="Anything the family should read alongside it."
            defaultValue={selection.notes ?? ""}
            onBlur={(event) => {
              const next = event.target.value;
              if (next === (selection.notes ?? "")) return;
              void act(() =>
                updateMerchandiseSelection(caseId, { notes: next === "" ? null : next }),
              );
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(statementUrl(caseId), "_blank", "noopener")}
          >
            <Printer className="size-4" />
            {confirmed ? "Print the statement" : "Print what's chosen so far"}
          </Button>

          {confirmed ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void act(() => updateMerchandiseSelection(caseId, { confirmed: false }))
              }
            >
              Reopen it
            </Button>
          ) : (
            <Button
              disabled={busy || empty}
              onClick={() =>
                void act(() => updateMerchandiseSelection(caseId, { confirmed: true }))
              }
            >
              <Check className="size-4" />
              Agree this arrangement
            </Button>
          )}
        </div>

        {confirmed && !isPreNeed && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h3 className="font-medium">Your own books</h3>
            <p className="text-sm text-muted-foreground max-w-prose">
              We don't take payments and can't tell you whether this was paid.
              Tick this when your own records say it was, so the family stops
              being shown a way to pay.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="settled-note">Note for yourself</Label>
                <Input
                  id="settled-note"
                  placeholder="Paid by check, 14 March."
                  defaultValue={selection.settledNote ?? ""}
                  onBlur={(event) => {
                    const next = event.target.value;
                    if (next === (selection.settledNote ?? "")) return;
                    void act(() =>
                      updateMerchandiseSelection(caseId, {
                        settledNote: next === "" ? null : next,
                      }),
                    );
                  }}
                />
              </div>
              <Button
                variant={selection.settledAt ? "secondary" : "outline"}
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    updateMerchandiseSelection(caseId, { settled: !selection.settledAt }),
                  )
                }
              >
                {selection.settledAt ? "Settled in your records" : "Mark settled"}
              </Button>
            </div>
          </div>
        )}

        {isPreNeed && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground max-w-prose">
            This is a plan. Nothing is owed on it and nothing is collected for
            it here — selling a pre-need contract is done under your own
            Division of Insurance licence, through your own trustee or
            insurer, outside this software.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h3 className="font-medium">The General Price List</h3>
          {selection.gplShownAt ? (
            <p className="text-sm text-muted-foreground">
              This family has it, so caskets and outer burial containers are
              showing.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                They haven't opened it yet, so they're seeing no caskets and no
                vaults. If you handed one across the desk, record that here.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void act(() => recordGplGiven(caseId))}
              >
                <Lock className="size-4" />
                I gave them the price list
              </Button>
            </>
          )}
        </div>

        {!confirmed && (
          <>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="font-medium">Add something</h3>

              <Select
                value={picking}
                onValueChange={(value) => {
                  setPicking("");
                  const [kind, id] = value.split(":");
                  if (kind === "item") {
                    void act(() =>
                      addSelectionItem(caseId, { itemId: Number(id) }),
                    );
                  } else {
                    void act(() => addSelectionPackage(caseId, { packageId: Number(id) }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="From your catalogue" />
                </SelectTrigger>
                <SelectContent>
                  {data.packages.map((pack) => (
                    <SelectItem key={`p${pack.id}`} value={`package:${pack.id}`}>
                      {pack.name} — {formatPrice(pack.priceCents)} (package)
                    </SelectItem>
                  ))}
                  {data.categories.flatMap((category) =>
                    category.items.map((item) => (
                      <SelectItem key={`i${item.id}`} value={`item:${item.id}`}>
                        {item.name} — {formatPrice(item.priceCents)}
                      </SelectItem>
                    )),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="font-medium">They're bringing their own</h3>
              <p className="text-sm text-muted-foreground">
                A casket or urn bought elsewhere. There is no charge for
                handling one, and no field here to put one in.
              </p>
              <div className="flex gap-2">
                <Input
                  aria-label="What they're bringing"
                  placeholder="Her mother's urn"
                  value={broughtIn}
                  onChange={(event) => setBroughtIn(event.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={busy || broughtIn.trim() === ""}
                  onClick={() =>
                    void act(async () => {
                      await addFamilyProvidedItem(caseId, { name: broughtIn.trim() });
                      setBroughtIn("");
                    })
                  }
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
