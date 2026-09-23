import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyBelongings,
  useCreateFamilyBelonging,
  useUpdateFamilyBelonging,
  useDeleteFamilyBelonging,
  useGetFamilyPreparation,
  useUpdateFamilyPreparation,
  getGetFamilyBelongingsQueryKey,
  getGetFamilyPreparationQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Lock, Plus, Shirt, X } from "lucide-react";
import { Divider, Empty, Loading, PageHeader } from "@/components/page";

/**
 * What to bring in, and how they should look.
 *
 * The two hardest questions a director has to ask across a desk — "what would
 * you like her to wear" and "how did she do her hair" — asked here instead,
 * where the family can answer them at home, at their own pace, and go and
 * look in a wardrobe before replying.
 *
 * The disposition control is the important one. Whether a wedding ring stays
 * on or comes back is a decision families most often want to sleep on, so it
 * defaults to undecided and stays changeable right up until the home takes
 * the item in.
 */

const DISPOSITIONS = [
  { value: "undecided", label: "Not decided yet" },
  { value: "with_deceased", label: "Stays with them" },
  { value: "return_to_family", label: "Comes back to us" },
];

const KINDS = [
  { value: "clothing", label: "Clothing" },
  { value: "undergarments", label: "Undergarments" },
  { value: "shoes", label: "Shoes" },
  { value: "jewellery", label: "Jewellery" },
  { value: "glasses", label: "Glasses" },
  { value: "keepsake", label: "Something to go with them" },
  { value: "other", label: "Something else" },
];

export default function Belongings() {
  const queryClient = useQueryClient();
  const items = useGetFamilyBelongings();
  const preparation = useGetFamilyPreparation();

  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("keepsake");

  const refreshItems = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetFamilyBelongingsQueryKey(),
    });
  const refreshPrep = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetFamilyPreparationQueryKey(),
    });

  const add = useCreateFamilyBelonging({
    mutation: {
      onSuccess: () => {
        setDescription("");
        refreshItems();
      },
    },
  });
  const update = useUpdateFamilyBelonging({ mutation: { onSuccess: refreshItems } });
  const remove = useDeleteFamilyBelonging({ mutation: { onSuccess: refreshItems } });
  const savePrep = useUpdateFamilyPreparation({ mutation: { onSuccess: refreshPrep } });

  if (items.isPending || preparation.isPending) return <Loading rows={4} />;

  const rows = items.data ?? [];
  const prep = preparation.data;

  return (
    <div className="space-y-8">
      <PageHeader title="Clothing and belongings">
        Take your time with this. Nothing here has to be answered today, and
        you can change your mind until the funeral home has the item.
      </PageHeader>

      <section className="space-y-3">
        <Divider label="What they'll wear, and what to keep" />

        {rows.length === 0 && (
          <Empty icon={Shirt} title="Nothing listed yet">
            Add a suit, a dress, a ring — anything you would like them to have
            with them, or anything you want back afterwards.
          </Empty>
        )}

        <ul className="space-y-2.5">
          {rows.map((item) => {
            const held = item.receivedAt !== null;

            return (
              <li
                key={item.id}
                className={`space-y-2.5 rounded-xl border bg-card p-3.5 shadow-[var(--elevation-1)] ${
                  held ? "border-[var(--accent)]/30 bg-[var(--sunken)]" : "border-border"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      defaultValue={item.description}
                      disabled={held}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (!next || next === item.description) return;
                        update.mutate({
                          belongingId: item.id,
                          data: { description: next },
                        });
                      }}
                    />
                  </div>

                  {held ? (
                    <span
                      className="mt-2 flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-deep)]"
                      title="The funeral home has this."
                    >
                      <Lock className="size-3" />
                      With them
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground"
                      aria-label={`Remove ${item.description}`}
                      onClick={() => remove.mutate({ belongingId: item.id })}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>

                <Select
                  value={item.disposition}
                  disabled={held}
                  onValueChange={(value) =>
                    update.mutate({
                      belongingId: item.id,
                      data: { disposition: value as "undecided" },
                    })
                  }
                >
                  <SelectTrigger aria-label={`What should happen to ${item.description}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISPOSITIONS.map((entry) => (
                      <SelectItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {held && item.returnedAt && (
                  <p className="text-sm text-muted-foreground">
                    Returned to {item.returnedToName ?? "the family"}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {/* Adding something: one line, kept visually apart from the list. */}
        <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-[var(--border-strong)] p-2.5">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="Kind of item" className="w-[11rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={description}
            placeholder="Her mother's locket"
            className="min-w-[10rem] flex-1"
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (description.trim()) {
                add.mutate({ data: { kind: kind as "other", description: description.trim() } });
              }
            }}
          />

          <Button
            variant="outline"
            size="icon"
            aria-label="Add item"
            disabled={!description.trim()}
            onClick={() =>
              add.mutate({
                data: { kind: kind as "other", description: description.trim() },
              })
            }
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      <section className="space-y-5">
        <Divider label="How they looked" />

        <p className="text-muted-foreground">
          Whatever you can tell us helps. Even "she never wore makeup" is
          exactly the sort of thing we need to know.
        </p>

        {prep?.reviewedAt && (
          <p className="flex items-center gap-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm font-semibold text-[var(--accent-deep)]">
            <Check className="size-4" />
            The funeral home has read this.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="hair">Their hair</Label>
          <Textarea
            id="hair"
            rows={3}
            placeholder="How it was parted, whether it was set, who used to do it."
            defaultValue={prep?.hairNotes ?? ""}
            onBlur={(event) =>
              savePrep.mutate({
                data: { hairNotes: event.target.value.trim() || null },
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cosmetics">Makeup</Label>
          <Textarea
            id="cosmetics"
            rows={3}
            placeholder="How much, and what they wore. Or that they never wore any."
            defaultValue={prep?.cosmeticsNotes ?? ""}
            onBlur={(event) =>
              savePrep.mutate({
                data: { cosmeticsNotes: event.target.value.trim() || null },
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="jewellery">Jewellery they should be wearing</Label>
          <Textarea
            id="jewellery"
            rows={2}
            placeholder="Her wedding ring, left hand."
            defaultValue={prep?.jewelleryNotes ?? ""}
            onBlur={(event) =>
              savePrep.mutate({
                data: { jewelleryNotes: event.target.value.trim() || null },
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="other">Anything else</Label>
          <Textarea
            id="other"
            rows={3}
            placeholder="A scarf she always wore. Glasses on or off. Anything at all."
            defaultValue={prep?.otherNotes ?? ""}
            onBlur={(event) =>
              savePrep.mutate({
                data: { otherNotes: event.target.value.trim() || null },
              })
            }
          />
        </div>

        <p className="border-l-2 border-[var(--accent)]/30 pl-4 text-sm leading-relaxed text-muted-foreground">
          It also helps enormously to mark a recent photograph as “this is how
          they looked” on the photographs page.
        </p>
      </section>
    </div>
  );
}
