import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyObituary,
  useUpdateFamilyObituary,
  useSubmitFamilyObituary,
  getGetFamilyObituaryQueryKey,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2 } from "lucide-react";

/**
 * The obituary, as a form rather than a blank page.
 *
 * A blank box asking a grieving family to "write the obituary" is where this
 * stalls for three days. Named questions are answerable one at a time, in any
 * order, by different relatives, at two in the morning — and the funeral home
 * composes the prose from them afterwards.
 *
 * Every field saves on blur and none of them is required. Somebody who only
 * knows the grandchildren's names should be able to add those and close the
 * tab.
 */

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  value: string | null;
  multiline?: boolean;
  disabled: boolean;
  onSave: (value: string | null) => void;
};

function Field({ id, label, hint, value, multiline, disabled, onSave }: FieldProps) {
  const Control = multiline ? Textarea : Input;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <Control
        id={id}
        defaultValue={value ?? ""}
        disabled={disabled}
        rows={multiline ? 5 : undefined}
        onBlur={(event: { target: { value: string } }) => {
          const next = event.target.value.trim();
          if (next === (value ?? "")) return;
          onSave(next || null);
        }}
      />
    </div>
  );
}

export default function Obituary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const obituary = useGetFamilyObituary();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetFamilyObituaryQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilySessionQueryKey() });
  };

  const update = useUpdateFamilyObituary({
    mutation: {
      onSuccess: () => {
        setSavedAt(Date.now());
        refresh();
      },
    },
  });

  const submit = useSubmitFamilyObituary({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({
          title: "Sent to the funeral home",
          description: "You can still change it until they approve it for print.",
        });
      },
    },
  });

  if (obituary.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!obituary.data) return null;

  const draft = obituary.data;
  const locked = draft.status === "approved";
  const save = (field: string) => (value: string | null) =>
    update.mutate({ data: { [field]: value } });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">The obituary</h1>
        <p className="text-muted-foreground">
          {locked
            ? "The funeral home has approved this for print. Send them a message if something needs changing."
            : "Answer whatever you can. Nothing is required, and it saves as you go."}
        </p>
      </header>

      {savedAt !== null && !locked && (
        <p className="flex items-center gap-1.5 text-sm text-[var(--accent-deep)]">
          <Check className="size-4" />
          Saved
        </p>
      )}

      <div className="space-y-5">
        <Field
          id="fullName"
          label="Their full name"
          hint="As it should be printed."
          value={draft.fullName}
          disabled={locked}
          onSave={save("fullName")}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="bornOn"
            label="Born"
            hint="A date, or just the year."
            value={draft.bornOn}
            disabled={locked}
            onSave={save("bornOn")}
          />
          <Field
            id="birthPlace"
            label="Born in"
            value={draft.birthPlace}
            disabled={locked}
            onSave={save("birthPlace")}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="diedOn"
            label="Died"
            value={draft.diedOn}
            disabled={locked}
            onSave={save("diedOn")}
          />
          <Field
            id="deathPlace"
            label="Died at"
            value={draft.deathPlace}
            disabled={locked}
            onSave={save("deathPlace")}
          />
        </div>

        <Field
          id="biography"
          label="Their life"
          hint="Work, where they lived, what they loved, what they were like. A few sentences is plenty."
          value={draft.biography}
          multiline
          disabled={locked}
          onSave={save("biography")}
        />

        <Field
          id="survivedBy"
          label="Survived by"
          hint="Names, and how they were related. Take your time over the spellings."
          value={draft.survivedBy}
          multiline
          disabled={locked}
          onSave={save("survivedBy")}
        />

        <Field
          id="precededBy"
          label="Preceded in death by"
          value={draft.precededBy}
          disabled={locked}
          onSave={save("precededBy")}
        />

        <Field
          id="inLieuOfFlowers"
          label="In lieu of flowers"
          hint="A charity, if there is one."
          value={draft.inLieuOfFlowers}
          disabled={locked}
          onSave={save("inLieuOfFlowers")}
        />

        <Field
          id="specialThanks"
          label="Anyone to thank"
          hint="Carers, a hospice, a ward."
          value={draft.specialThanks}
          multiline
          disabled={locked}
          onSave={save("specialThanks")}
        />
      </div>

      {!locked && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            When you've put in what you can, let the funeral home know. They'll
            write it up and check it with you.
          </p>
          <Button
            type="button"
            className="w-full"
            disabled={submit.isPending || draft.status === "submitted"}
            onClick={() => submit.mutate()}
          >
            {draft.status === "submitted"
              ? "Sent to the funeral home"
              : "I've finished for now"}
          </Button>
        </div>
      )}
    </div>
  );
}
