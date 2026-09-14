import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  catalogueQueryKey,
  priceListUrl,
  saveStorefrontSettings,
  storefrontSettingsQueryKey,
  useStorefrontSettings,
  PRICE_LIST_LABELS,
  PRICE_LIST_KINDS,
  type Catalogue,
  type PriceListKind,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Printer } from "lucide-react";

/**
 * The price list, and the date that turns the storefront on.
 *
 * A General Price List carries an effective date, and until this home has
 * set one it has no GPL — which means no family is shown a casket, because
 * the Funeral Rule says the list comes first and this is where that sequence
 * begins. Saying that plainly here is better than letting a director wonder
 * why the caskets they just loaded are not appearing.
 *
 * The disclosure boxes are empty and stay empty. The Rule prescribes what
 * each has to convey; the words are the home's and their lawyer's. We name
 * the slots, say what each is for, and print what the home writes.
 */

function isoDay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function PriceListPanel({ catalogue }: { catalogue: Catalogue }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settings = useStorefrontSettings();

  const [saving, setSaving] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: storefrontSettingsQueryKey });
    void queryClient.invalidateQueries({ queryKey: catalogueQueryKey });
  };

  async function save(values: Parameters<typeof saveStorefrontSettings>[0]) {
    setSaving(true);
    try {
      await saveStorefrontSettings(values);
      refresh();
    } catch (error) {
      toast({
        title: "That didn't save",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (settings.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const current = settings.data;
  if (!current) return null;

  const sections = new Set(catalogue.categories.map((category) => category.section));

  const available: Record<PriceListKind, boolean> = {
    gpl: catalogue.categories.some((category) => category.items.length > 0),
    cpl: catalogue.categories.some(
      (category) => category.section === "caskets" && category.items.length > 0,
    ),
    obcpl: catalogue.categories.some(
      (category) =>
        category.section === "outer_burial_containers" && category.items.length > 0,
    ),
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Your General Price List</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Families are shown caskets and outer burial containers only once
            your General Price List is ready and they have it. Setting the
            effective date below is what makes it ready.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="gpl-effective">Effective from</Label>
            <Input
              id="gpl-effective"
              type="date"
              className="w-48"
              defaultValue={isoDay(current.gplEffectiveOn)}
              onBlur={(event) => {
                const next = event.target.value;
                if (next === isoDay(current.gplEffectiveOn)) return;
                void save({ gplEffectiveOn: next === "" ? null : next });
              }}
            />
          </div>

          <p className="pb-2 text-sm text-muted-foreground">
            {current.hasGeneralPriceList
              ? "Printed at the top of every list."
              : "Until this is set, your caskets stay out of the family's view."}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Print a price list</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Each opens as a printable sheet. Your browser's print dialogue will
            write a PDF you can email, or put straight on paper.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRICE_LIST_KINDS.map((kind) => (
            <Button
              key={kind}
              variant="outline"
              disabled={!available[kind]}
              title={
                available[kind]
                  ? undefined
                  : kind === "cpl"
                    ? "You have no caskets in your catalogue yet."
                    : kind === "obcpl"
                      ? "You have no outer burial containers in your catalogue yet."
                      : "There is nothing in your catalogue yet."
              }
              onClick={() => window.open(priceListUrl(kind), "_blank", "noopener")}
            >
              <Printer className="size-4" />
              {PRICE_LIST_LABELS[kind]}
            </Button>
          ))}
        </div>

        {!available.cpl && sections.has("caskets") && (
          <p className="text-sm text-muted-foreground">
            You have a casket category with nothing in it yet.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">What your price list has to say</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            The Funeral Rule requires a General Price List to carry these
            disclosures. The wording is yours — we print what you write and
            leave out anything you have not. If you are not sure, your state
            association or your attorney will have language you can use.
          </p>
        </div>

        <div className="space-y-4">
          {current.disclosureSlots.map((slot) => (
            <div key={slot.key} className="space-y-1.5">
              <Label htmlFor={`disclosure-${slot.key}`}>{slot.title}</Label>
              <p className="text-sm text-muted-foreground max-w-prose">
                {slot.note}
              </p>
              <Textarea
                id={`disclosure-${slot.key}`}
                rows={3}
                placeholder="Your own wording"
                defaultValue={current.disclosures[slot.key] ?? ""}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next === (current.disclosures[slot.key] ?? "")) return;
                  void save({ disclosures: { [slot.key]: next } });
                }}
              />
            </div>
          ))}

          <div className="space-y-1.5">
            <Label htmlFor="footnote">At the foot of every list</Label>
            <Textarea
              id="footnote"
              rows={2}
              placeholder="Prices are subject to change without notice."
              defaultValue={current.priceListFootnote ?? ""}
              onBlur={(event) => {
                const next = event.target.value;
                if (next === (current.priceListFootnote ?? "")) return;
                void save({ priceListFootnote: next === "" ? null : next });
              }}
            />
          </div>
        </div>

        {saving && (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
            Saving
          </p>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">How you're paid</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            We never take money from a family. A family who owes you is sent to
            your own payment page, at your own processor, and told plainly
            where the link goes. Leave it blank and they are asked to telephone
            you instead, which is not a worse answer.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payment-url">Your payment page</Label>
          <Input
            id="payment-url"
            type="url"
            inputMode="url"
            placeholder="https://"
            defaultValue={current.paymentPageUrl ?? ""}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next === (current.paymentPageUrl ?? "")) return;
              void save({ paymentPageUrl: next === "" ? null : next });
            }}
          />
          <p className="text-sm text-muted-foreground">
            Must start with https://. It appears on the statement with its
            address shown in full underneath.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="payment-instructions">Your other ways to pay</Label>
          <Textarea
            id="payment-instructions"
            rows={3}
            placeholder="Where to post a check, who to ask for, when the office is open."
            defaultValue={current.paymentInstructions ?? ""}
            onBlur={(event) => {
              const next = event.target.value;
              if (next === (current.paymentInstructions ?? "")) return;
              void save({ paymentInstructions: next === "" ? null : next });
            }}
          />
        </div>
      </section>
    </div>
  );
}
