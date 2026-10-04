import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyVitals,
  useGetFamilySession,
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
import { voiceFor, type CaseVoice } from "@/lib/voice";

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

type Section = { title: string; blurb?: string; fields: Field[] };

/**
 * The sections, in the voice this file needs.
 *
 * On a plan every fact here is the reader's own: the labels say "your", the
 * present is the present ("Where you live"), and the reason to answer is
 * that a family will not have to hunt for it later, rather than that a
 * certificate is waiting on it.
 */
function sectionsFor(voice: CaseVoice): Section[] {
  const { preNeed } = voice;

  const sections: Section[] = [
    {
      title: `${voice.Their} details`,
      fields: [
        { name: "legalFirstName", label: "First name" },
        { name: "legalMiddleName", label: "Middle name" },
        { name: "legalLastName", label: "Last name" },
        {
          name: "suffix",
          label: "Suffix",
          hint: preNeed
            ? "Jr., Sr., III — only if you use one."
            : "Jr., Sr., III — only if they used one.",
        },
        {
          name: "nameAtBirth",
          label: preNeed ? "Your name at birth" : "Name at birth",
          hint: "If it was different — a maiden name, or a name that changed.",
        },
        { name: "dateOfBirth", label: "Date of birth", type: "date" },
        { name: "birthCity", label: "Town or city of birth" },
        { name: "birthState", label: "State of birth" },
        {
          name: "birthCountry",
          label: "Country of birth",
          hint: `Only if ${voice.they} were born outside the United States.`,
        },
        { name: "sex", label: "Sex as recorded" },
      ],
    },
    {
      title: `${voice.Their} parents`,
      blurb: preNeed
        ? "Both parents are asked for. Your mother's name before she married is the one a family most often has to hunt for."
        : "Both parents are asked for, however long ago they died. The mother's name before marriage is the one that most often holds a certificate up.",
      fields: [
        { name: "fatherFirstName", label: "Father's first name" },
        { name: "fatherMiddleName", label: "Father's middle name" },
        { name: "fatherLastName", label: "Father's last name" },
        { name: "motherFirstName", label: "Mother's first name" },
        { name: "motherMiddleName", label: "Mother's middle name" },
        {
          name: "motherMaidenName",
          label: "Mother's last name before she married",
          hint: preNeed
            ? "Her maiden name."
            : "Her maiden name. Worth a phone call to an aunt if nobody is sure.",
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
      blurb: `${voice.Their} usual work over most of ${voice.their} life, not ${voice.their} last job.`,
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
      title: preNeed ? "Where you live" : "Where they lived",
      fields: [
        { name: "residenceLine1", label: "Address" },
        { name: "residenceCity", label: "Town or city" },
        { name: "residenceCounty", label: "County" },
        { name: "residenceState", label: "State" },
        { name: "residencePostalCode", label: "ZIP" },
        {
          name: "residenceInsideCityLimits",
          label: "The address is inside the city or town limits",
          type: "checkbox",
        },
      ],
    },
    {
      title: "Military service",
      blurb: preNeed
        ? "A veteran is entitled to a flag, a headstone and burial in a national cemetery. Families often do not know to ask, so it is worth noting here."
        : "Worth answering even if you are not sure. A veteran is entitled to a flag, a headstone and burial in a national cemetery, and families often do not know.",
      fields: [
        {
          name: "veteran",
          label: `${voice.They} served in the armed forces`,
          type: "checkbox",
        },
        { name: "veteranBranch", label: "Which branch" },
        { name: "veteranServiceDates", label: "Roughly when" },
        {
          name: "veteranDischargeDocument",
          label: "Discharge papers",
          hint: preNeed
            ? "A DD-214, if you have one. Say where it is kept, so your family can find it."
            : "A DD-214, if you can find one. Tell us where it is and we'll take it from there.",
        },
      ],
    },
  ];

  /*
   * "About you" — the informant — is not asked on a plan. The informant is
   * whoever gives these facts to the registrar after a death, and the
   * person the registrar rings with a question. Somebody reading their own
   * plan is the person the facts are about, so cannot be that, and who it
   * will be is not known yet; asking them to name who will report their
   * death would be the one question on this page about their death rather
   * than their life. When the file becomes at-need, whoever opens this page
   * then is asked, with their own details already filled in.
   */
  return preNeed ? sections : [...sections, INFORMANT];
}

/** Who supplied the details. Asked only on an at-need file: see `sectionsFor`. */
const INFORMANT: Section = {
  title: "About you",
  blurb:
    "So the registrar knows who supplied these details. Filled in from what the funeral home has for you — change anything that isn't right.",
  fields: [
    { name: "informantName", label: "Your name" },
    { name: "informantRelationship", label: "Your relationship to them" },
    { name: "informantPhone", label: "Your phone number", type: "tel" },
  ],
};

export default function Vitals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const vitals = useGetFamilyVitals();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [ssn, setSsn] = useState("");
  const session = useGetFamilySession();
  const contact = session.data?.contact;
  const voice = voiceFor(session.data?.case.kind);
  const sections = sectionsFor(voice);

  /*
   * "About you" arrives filled from the family contact the home already
   * holds — the person reading this is, nearly always, the informant — so
   * nobody types their own name into a form that was sent to them by name.
   * What is shown but was never typed over is written to the record when
   * they say they have finished; a box they emptied on purpose is left
   * empty (`touched`).
   *
   * Nothing is suggested on a plan, which does not ask the question at all
   * (see `sectionsFor`). It used to be filled from the reader's own contact
   * there too, and sending the page wrote it to the record: the reader
   * named as the informant on their own certificate.
   */
  const suggested: Record<string, string | null | undefined> = voice.preNeed
    ? {}
    : {
        informantName: contact?.name,
        informantRelationship: contact?.relationship,
        informantPhone: contact?.phone,
      };
  const touched = useRef(new Set<string>());

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetFamilyVitalsQueryKey() });

  const save = useUpdateFamilyVitals({
    mutation: {
      onSuccess: () => {
        setSavedAt(Date.now());
        refresh();
      },
      // "Saved" left on screen after a failure is the one message here that
      // would be worse than none.
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

  if (vitals.isError && !vitals.data) {
    return <LoadFailed title="Details for the certificate" onRetry={() => void vitals.refetch()} />;
  }

  if (!vitals.data) return null;

  const record = vitals.data as unknown as Record<string, unknown>;
  const stored = (name: string) => (record[name] as string | null) ?? "";
  const shown = (name: string) => stored(name) || (suggested[name] ?? "") || "";
  const submitted = vitals.data.status === "submitted";
  const unsavedSuggestions = Object.fromEntries(
    Object.keys(suggested)
      .filter((name) => !stored(name) && suggested[name] && !touched.current.has(name))
      .map((name) => [name, suggested[name]]),
  );
  const hasUnsaved = Object.keys(unsavedSuggestions).length > 0;
  const locked = vitals.data.status === "verified";

  return (
    <div className="space-y-6 pb-16">
      {/*
        On a plan nothing is waiting to be issued. What is true, and worth
        saying, is why it helps to answer now.
      */}
      <PageHeader title="Details for the certificate">
        {voice.preNeed
          ? "The state will ask for these one day, and they are the details a family most often has to hunt for. Anything you can put down now spares them the search — it saves as you go, and you can stop and come back."
          : "The state asks for these before a death certificate can be issued, and almost none of it is anything we would know. Answer what you can — it saves as you go, and you can stop and come back."}
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

      {sections.map((section) => (
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
                  aria-label={field.label}
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
                  Saved only when this person changed it, and redrawn when a
                  newer answer arrives -- the obituary's rule, for the same
                  reason: two relatives fill this in on two phones, and
                  tabbing through a box must not put back what was on file
                  when the page first opened.
                */}
                <Input
                  key={stored(field.name)}
                  className="mt-2"
                  id={field.name}
                  type={field.type ?? "text"}
                  autoComplete="off"
                  disabled={locked}
                  defaultValue={shown(field.name)}
                  onFocus={(event) => {
                    event.currentTarget.dataset.before = event.currentTarget.value;
                  }}
                  onBlur={(event) => {
                    if (event.target.value === event.target.dataset.before) return;
                    touched.current.add(field.name);
                    const next = event.target.value.trim();
                    if (next === stored(field.name)) return;
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
          Required on the certificate. It is stored encrypted, and once it is
          saved this page will only ever say that one is on file: nobody,
          including you, can read it back here. The funeral home sees just the
          last four digits, to check it against their paperwork. That means it
          cannot be read off this page if your phone is left on a table.
        </p>

        {/*
          Whether one is on file, and none of its digits: a family's link
          gets forwarded, so even the last four are for the funeral home
          alone.
        */}
        {vitals.data.hasSocialSecurityNumber ? (
          <p className="text-sm font-medium">
            {voice.preNeed ? "Yours is on file." : "One is on file."}
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
              // Cleared once it is safely stored, not before: a number that
              // failed to save on a bad connection should still be there to
              // send again, not have to be fetched from a drawer twice.
              onClick={() =>
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
          {/*
            Already sent, but with "About you" still showing only what was
            suggested: the button stays pressable, and says it will keep
            those, so nothing the family can see on the page is missing from
            what the home receives.
          */}
          <Button
            size="lg"
            className="w-full"
            disabled={
              submit.isPending ||
              save.isPending ||
              (submitted && !hasUnsaved)
            }
            onClick={() => {
              if (!hasUnsaved) {
                submit.mutate();
                return;
              }
              save.mutate(
                { data: unsavedSuggestions },
                { onSuccess: () => !submitted && submit.mutate() },
              );
            }}
          >
            {submitted
              ? hasUnsaved
                ? "Keep your details and send them"
                : "Sent to the funeral home"
              : "I've finished for now"}
          </Button>
        </div>
      )}
    </div>
  );
}
