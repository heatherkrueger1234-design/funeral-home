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
import { Check, Lock } from "lucide-react";
import { Divider, LoadFailed, Loading, PageHeader } from "@/components/page";

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
    <div>
      <Label htmlFor={id}>{label}</Label>
      {hint && (
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{hint}</p>
      )}
      {/*
        Saved only when this person changed it, not merely because they
        tabbed through it.

        The obituary is written by several relatives at once, a field each,
        which is the point of splitting it into fields. But this box is
        uncontrolled, so it holds whatever was on file when the screen opened;
        a sister who had since filled in "Survived by" on her own phone had it
        silently put back to the old text the moment her brother's cursor
        passed through the box on his way to "In lieu of flowers". Comparing
        with what the box held on focus, rather than with the server's copy,
        is what tells an edit from a tab. `key` redraws it with the newer text
        once it arrives.
      */}
      <Control
        key={value ?? ""}
        className="mt-2"
        id={id}
        defaultValue={value ?? ""}
        disabled={disabled}
        rows={multiline ? 5 : undefined}
        onFocus={(event: { currentTarget: HTMLElement & { value: string } }) => {
          event.currentTarget.dataset.before = event.currentTarget.value;
        }}
        onBlur={(event: { target: HTMLElement & { value: string } }) => {
          if (event.target.value === event.target.dataset.before) return;
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
      onError: () => setSavedAt(null),
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

  if (obituary.isPending) return <Loading rows={5} />;

  if (obituary.isError && !obituary.data) {
    return <LoadFailed title="The obituary" onRetry={() => void obituary.refetch()} />;
  }

  if (!obituary.data) return null;

  const draft = obituary.data;
  const locked = draft.status === "approved";
  const save = (field: string) => (value: string | null) =>
    update.mutate({ data: { [field]: value } });

  return (
    <div className="space-y-7 pb-16">
      <PageHeader title="The obituary">
        {locked
        ? "The funeral home has approved this for print. Send them a message if something needs changing."
        : "Answer whatever you can. Nothing is required, and it saves as you go."}
      </PageHeader>

      {/*
        Pinned to the corner of the screen rather than set in the flow. It used
        to sit between the heading and the first question, which meant the
        whole form jumped down a line the first time anybody answered
        anything — on a phone, mid-typing.
      */}
      {savedAt !== null && !locked && (
        <p
          role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--accent)]/20 bg-card px-3.5 py-1.5 text-sm font-semibold text-[var(--accent-deep)] shadow-[var(--elevation-2)]"
        >
          <Check className="size-4" />
          Saved
        </p>
      )}

      {locked && (
        <p className="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5 text-sm leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          This has been approved for print, so it can no longer be edited here.
        </p>
      )}

      <div className="space-y-5">
        <Divider label="Their name and dates" />

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

        <div className="pt-2">
          <Divider label="Their life" />
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

        <div className="pt-2">
          <Divider label="Family" />
        </div>

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

        <div className="pt-2">
          <Divider label="Anything else" />
        </div>

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
          hint="Caregivers, a hospice, the nurses on a ward."
          value={draft.specialThanks}
          multiline
          disabled={locked}
          onSave={save("specialThanks")}
        />
      </div>

      {!locked && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            When you've put in what you can, let the funeral home know. They'll
            write it up and check it with you.
          </p>
          <Button
            type="button"
            size="lg"
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
