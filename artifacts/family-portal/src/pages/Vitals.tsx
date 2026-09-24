import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyVitals,
  useUpdateFamilyVitals,
  useSubmitFamilyVitals,
  getGetFamilyVitalsQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Check, Lock, ShieldCheck } from "lucide-react";
import { LoadFailed, Loading, PageHeader } from "@/components/page";

/**
 * The death certificate questions.
 *
 * This screen is doing something the rest of the portal does not: asking for
 * facts the family will have to go and find. A maiden name means ringing an
 * aunt; a discharge document means a drawer. So it is built for stopping and
 * coming back — every field saves on blur, nothing is required, and the
 * sections are short enough to finish one and put the phone down.
 *
 * The tone matters here too. These are bureaucratic questions arriving in the
 * middle of a grief, and the honest framing is that the state asks them and
 * the funeral home needs them to file — not that we are curious.
 */

type Field = {
  name: string;
  label: string;
  hint?: string;
  type?: "text" | "date" | "tel" | "checkbox";
};

const SECTIONS: Array<{ title: string; blurb?: string; fields: Field[] }> = [
  {
    title: "Their details",
    fields: [
      { name: "legalFirstName", label: "First name" },
      { name: "legalMiddleName", label: "Middle name" },
      { name: "legalLastName", label: "Last name" },
      {
        name: "nameAtBirth",
        label: "Name at birth",
        hint: "If it was different — a maiden name, or a name that changed.",
      },
      { name: "dateOfBirth", label: "Date of birth", type: "date" },
      { name: "birthCity", label: "Town or city of birth" },
      { name: "birthState", label: "State of birth" },
      {
        name: "birthCountry",
        label: "Country of birth",
        hint: "Only if they were born outside the United States.",
      },
      { name: "sex", label: "Sex as recorded" },
    ],
  },
  {
    title: "Their parents",
    blurb:
      "Both parents are asked for, however long ago they died. The mother's name before marriage is the one that most often holds a certificate up.",
    fields: [
      { name: "fatherFirstName", label: "Father's first name" },
      { name: "fatherMiddleName", label: "Father's middle name" },
      { name: "fatherLastName", label: "Father's last name" },
      { name: "motherFirstName", label: "Mother's first name" },
      { name: "motherMiddleName", label: "Mother's middle name" },
      {
        name: "motherMaidenName",
        label: "Mother's last name before she married",
        hint: "Her maiden name. Worth a phone call to an aunt if nobody is sure.",
      },
    ],
  },
  {
    title: "Marriage",
    fields: [
      {
        name: "maritalStatus",
        label: "Married, widowed, divorced, or never married",
      },
      { name: "spouseName", label: "Husband or wife's name" },
      {
        name: "spouseNameAtBirth",
        label: "Their name before marriage",
        hint: "If it changed.",
      },
    ],
  },
  {
    title: "Work and schooling",
    blurb: "Their usual work over most of their life, not their last job.",
    fields: [
      { name: "occupation", label: "Usual occupation" },
      {
        name: "industry",
        label: "Kind of business",
        hint: "Teaching, farming, the railways.",
      },
      { name: "educationLevel", label: "Highest level of schooling" },
      { name: "raceEthnicity", label: "Race or ethnicity" },
      { name: "hispanicOrigin", label: "Hispanic origin, if any" },
    ],
  },
  {
    title: "Where they lived",
    fields: [
      { name: "residenceLine1", label: "Address" },
      { name: "residenceCity", label: "Town or city" },
      { name: "residenceCounty", label: "County" },
      { name: "residenceState", label: "State" },
      { name: "residencePostalCode", label: "ZIP" },
    ],
  },
  {
    title: "Military service",
    blurb:
      "Worth answering even if you are not sure. A veteran is entitled to a flag, a headstone and burial in a national cemetery, and families often do not know.",
    fields: [
      { name: "veteran", label: "They served in the armed forces", type: "checkbox" },
      { name: "veteranBranch", label: "Which branch" },
      { name: "veteranServiceDates", label: "Roughly when" },
      {
        name: "veteranDischargeDocument",
        label: "Discharge papers",
        hint: "A DD-214, if you can find one. Tell us where it is and we'll take it from there.",
      },
    ],
  },
  {
    title: "About you",
    blurb: "So the registrar knows who supplied these details.",
    fields: [
      { name: "informantName", label: "Your name" },
      { name: "informantRelationship", label: "Your relationship to them" },
      { name: "informantPhone", label: "Your phone number", type: "tel" },
    ],
  },
];

export default function Vitals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const vitals = useGetFamilyVitals();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [ssn, setSsn] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetFamilyVitalsQueryKey() });

  const save = useUpdateFamilyVitals({
    mutation: {
      onSuccess: () => {
        setSavedAt(Date.now());
        refresh();
      },
      onError: () => setSavedAt(null),
    },
  });

  const submit = useSubmitFamilyVitals({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({
          title: "Sent to the funeral home",
          description: "You can still add anything you find later.",
        });
      },
    },
  });

  if (vitals.isPending) return <Loading rows={5} />;

  if (!vitals.data) {
    return (
      <LoadFailed
        title="Details for the certificate"
        onRetry={() => void vitals.refetch()}
      />
    );
  }

  const record = vitals.data as unknown as Record<string, unknown>;
  const locked = vitals.data.status === "verified";

  return (
    <div className="space-y-6 pb-16">
      <PageHeader title="Details for the certificate">
        The state asks for these before a death certificate can be issued,
        and almost none of it is anything we would know. Answer what you can
        — it saves as you go, and you can stop and come back.
      </PageHeader>

      {locked && (
        <p className="flex items-start gap-2.5 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3.5 text-sm leading-relaxed text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          The funeral home has checked these against your documents. Send them
          a message if anything needs correcting.
        </p>
      )}

      {savedAt !== null && !locked && (
        <p
          role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--accent)]/20 bg-card px-3.5 py-1.5 text-sm font-semibold text-[var(--accent-deep)] shadow-[var(--elevation-2)]"
        >
          <Check className="size-4" />
          Saved
        </p>
      )}

      {SECTIONS.map((section) => (
        <section
          key={section.title}
          className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]"
        >
          <div className="mb-4">
            <h2 className="font-display text-lg">{section.title}</h2>
            {section.blurb && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {section.blurb}
              </p>
            )}
          </div>

          <div className="space-y-4">

          {section.fields.map((field) =>
            field.type === "checkbox" ? (
              <label
                key={field.name}
                className="flex cursor-pointer items-start gap-3 rounded-lg p-1 -m-1"
              >
                <Checkbox
                  className="mt-0.5"
                  disabled={locked}
                  checked={record[field.name] === true}
                  onCheckedChange={(checked) =>
                    save.mutate({ data: { [field.name]: checked === true } })
                  }
                />
                <span className="text-sm font-medium">{field.label}</span>
              </label>
            ) : (
              <div key={field.name}>
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.hint && (
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">
                    {field.hint}
                  </p>
                )}
                {/*
                  Saved only when this person changed it, as on the obituary:
                  a sister and a brother fill this in from two phones, and a
                  box that still held what was on file when the page opened
                  used to put her newer answer back the moment his cursor
                  passed through it. `key` redraws it once the newer text
                  arrives.
                */}
                <Input
                  key={(record[field.name] as string) ?? ""}
                  className="mt-2"
                  id={field.name}
                  type={field.type ?? "text"}
                  disabled={locked}
                  defaultValue={(record[field.name] as string) ?? ""}
                  onFocus={(event) => {
                    event.currentTarget.dataset.before = event.currentTarget.value;
                  }}
                  onBlur={(event) => {
                    if (event.target.value === event.target.dataset.before) return;
                    const next = event.target.value.trim();
                    if (next === ((record[field.name] as string) ?? "")) return;
                    save.mutate({ data: { [field.name]: next || null } });
                  }}
                />
              </div>
            ),
          )}
          </div>
        </section>
      ))}

      <section className="space-y-3 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-5">
        <h2 className="flex items-center gap-2.5 font-display text-lg text-[var(--accent-deep)]">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/70">
            <ShieldCheck className="size-4" strokeWidth={1.75} />
          </span>
          Social security number
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Required on the certificate. It is stored encrypted, and once you
          save it nobody — including you on this page — can read it back; the
          funeral home sees only the last four digits to check it against
          their paperwork. That means it cannot be read off this page if your
          phone is left on a table.
        </p>

        {vitals.data.hasSocialSecurityNumber ? (
          <p className="tabular text-sm font-medium">
            On file, ending {vitals.data.socialSecurityNumberMasked?.slice(-4)}.
            {!locked && " Type a new one below to replace it."}
          </p>
        ) : null}

        {!locked && (
          <div className="flex gap-2">
            <Input
              value={ssn}
              inputMode="numeric"
              placeholder="000-00-0000"
              autoComplete="off"
              aria-label="Social security number"
              onChange={(event) => setSsn(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={ssn.replace(/\D/g, "").length !== 9 || save.isPending}
              onClick={() =>
                // Cleared once it is stored, not before: a number that failed
                // to send on a dropped signal should still be there to resend.
                save.mutate(
                  { data: { socialSecurityNumber: ssn } },
                  { onSuccess: () => setSsn("") },
                )
              }
            >
              Save
            </Button>
          </div>
        )}
      </section>

      {!locked && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            When you've put in what you can, let the funeral home know. Anything
            you find afterwards can still be added.
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={submit.isPending || vitals.data.status === "submitted"}
            onClick={() => submit.mutate()}
          >
            {vitals.data.status === "submitted"
              ? "Sent to the funeral home"
              : "I've finished for now"}
          </Button>
        </div>
      )}
    </div>
  );
}
