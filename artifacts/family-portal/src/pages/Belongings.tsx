import { useState, type FocusEvent } from "react";
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
import { Divider, Empty, LoadFailed, Loading, PageHeader } from "@/components/page";

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
  // The stored value keeps the schema's spelling; the family reads US English.
  { value: "jewellery", label: "Jewelry" },
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

  // Enter and the button both come here, and neither sends a second copy
  // while the first is still on its way.
  const addItem = () => {
    const text = description.trim();
    if (!text || add.isPending) return;
    add.mutate({ data: { kind: kind as "other", description: text } });
  };

  /*
   * The four notes save when the box is left, and only if it was changed.
   * Every blur used to send whatever the box held, so tapping through
   * "Their hair" on the way to "Makeup" put back the text that was on file
   * when the page opened -- over a sister's answer typed since on her own
   * phone. The same rule the obituary follows.
   */
  const noteProps = (field: "hairNotes" | "cosmeticsNotes" | "jewelleryNotes" | "otherNotes") => ({
    defaultValue: preparation.data?.[field] ?? "",
    onFocus: (event: FocusEvent<HTMLTextAreaElement>) => {
      event.currentTarget.dataset.before = event.currentTarget.value;
    },
    onBlur: (event: FocusEvent<HTMLTextAreaElement>) => {
      if (event.target.value === event.target.dataset.before) return;
      const next = event.target.value.trim() || null;
      if (next === (preparation.data?.[field] ?? null)) return;
      savePrep.mutate({ data: { [field]: next } });
    },
  });

  if (items.isPending || preparation.isPending) return <Loading rows={4} />;

  if ((items.isError && !items.data) || (preparation.isError && !preparation.data)) {
    return (
      <LoadFailed
        title="Clothing and belongings"
        onRetry={() => {
          void items.refetch();
          void preparation.refetch();
        }}
      />
    );
  }

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
                {/*
                  Once the home has the item it is set as plain text rather
                  than as a greyed-out box. A disabled field cut "Navy dress
                  with the enamel brooch" off at "Navy dress with the enamel"
                  in a tint too faint to read, on exactly the rows the family
                  most wants to check.
                */}
                {held ? (
                  <div className="space-y-1.5">
                    <p className="break-words font-medium">{item.description}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 font-semibold text-[var(--accent-deep)]">
                        <Lock className="size-3" />
                        The funeral home has it
                      </span>
                      {DISPOSITIONS.find((entry) => entry.value === item.disposition)?.label}
                    </p>
                  </div>
                ) : (
                  /*
                    The description takes the full width and the remove sits
                    beside the choice below it. Sharing a line with "Remove"
                    cut "Photograph of Donald for her hand" to "Photograph of
                    Donald fo".
                  */
                  <>
                    <Input
                      aria-label="What this is"
                      defaultValue={item.description}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (!next || next === item.description) return;
                        update.mutate({
                          belongingId: item.id,
                          data: { description: next },
                        });
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Select
                          value={item.disposition}
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
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        aria-label={`Remove ${item.description}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ belongingId: item.id })}
                      >
                        <X className="size-4" />
                        Remove
                      </Button>
                    </div>
                  </>
                )}

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
          {/* Its own row on a phone: at a fixed 11rem, "Something to go
              with them" was cut to "Something to go with". */}
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="Kind of item" className="w-full sm:w-[15rem]">
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
            placeholder="What is it?"
            aria-label="Add something else to bring"
            className="min-w-[10rem] flex-1"
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addItem();
            }}
          />

          <Button
            variant="outline"
            aria-label="Add this to the list"
            disabled={!description.trim() || add.isPending}
            onClick={addItem}
          >
            <Plus className="size-4" />
            Add
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
            key={prep?.hairNotes ?? ""}
            {...noteProps("hairNotes")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cosmetics">Makeup</Label>
          <Textarea
            id="cosmetics"
            rows={3}
            placeholder="How much, and what they wore. Or that they never wore any."
            key={prep?.cosmeticsNotes ?? ""}
            {...noteProps("cosmeticsNotes")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="jewellery">Jewelry they should be wearing</Label>
          <Textarea
            id="jewellery"
            rows={2}
            placeholder="Her wedding ring, left hand."
            key={prep?.jewelleryNotes ?? ""}
            {...noteProps("jewelleryNotes")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="other">Anything else</Label>
          <Textarea
            id="other"
            rows={3}
            placeholder="A scarf she always wore. Glasses on or off. Anything at all."
            key={prep?.otherNotes ?? ""}
            {...noteProps("otherNotes")}
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
