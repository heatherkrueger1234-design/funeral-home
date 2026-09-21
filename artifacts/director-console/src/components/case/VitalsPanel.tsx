import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVitals,
  useUpdateVitals,
  useRevealSocialSecurityNumber,
  getGetVitalsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, ClipboardCopy, Eye, ShieldCheck, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Loading } from "@/components/page";

/**
 * The certificate details, from the home's side.
 *
 * The panel leads with what is still missing, because that is the question a
 * director actually has: not "what did they answer" but "can I file this on
 * Wednesday, and if not, who do I ring".
 */

const LABELS: Record<string, string> = {
  legalFirstName: "First name",
  legalLastName: "Last name",
  dateOfBirth: "Date of birth",
  birthCity: "Town of birth",
  birthState: "State of birth",
  socialSecurityNumber: "Social security number",
  fatherLastName: "Father's last name",
  motherMaidenName: "Mother's maiden name",
  residenceCity: "Town of residence",
  residenceState: "State of residence",
  informantName: "Informant",
};

const GROUPS: Array<{ title: string; fields: Array<[string, string]> }> = [
  {
    title: "The person",
    fields: [
      ["legalFirstName", "First name"],
      ["legalMiddleName", "Middle name"],
      ["legalLastName", "Last name"],
      ["nameAtBirth", "Name at birth"],
      ["dateOfBirth", "Date of birth"],
      ["birthCity", "Town of birth"],
      ["birthState", "State of birth"],
      ["birthCountry", "Country of birth"],
      ["sex", "Sex"],
    ],
  },
  {
    title: "Parents",
    fields: [
      ["fatherFirstName", "Father — first"],
      ["fatherMiddleName", "Father — middle"],
      ["fatherLastName", "Father — last"],
      ["motherFirstName", "Mother — first"],
      ["motherMiddleName", "Mother — middle"],
      ["motherMaidenName", "Mother — maiden"],
    ],
  },
  {
    title: "Marriage, work, residence",
    fields: [
      ["maritalStatus", "Marital status"],
      ["spouseName", "Spouse"],
      ["occupation", "Occupation"],
      ["industry", "Industry"],
      ["educationLevel", "Education"],
      ["raceEthnicity", "Race / ethnicity"],
      ["hispanicOrigin", "Hispanic origin"],
      ["residenceLine1", "Address"],
      ["residenceCity", "Town"],
      ["residenceCounty", "County"],
      ["residenceState", "State"],
      ["residencePostalCode", "ZIP"],
    ],
  },
  {
    title: "Service and informant",
    fields: [
      ["veteranBranch", "Branch"],
      ["veteranServiceDates", "Service dates"],
      ["veteranDischargeDocument", "Discharge papers"],
      ["informantName", "Informant"],
      ["informantRelationship", "Relationship"],
      ["informantPhone", "Phone"],
    ],
  },
];


/**
 * Copying, which is the whole point of this screen.
 *
 * Nothing here is typed twice on purpose. Every one of these fields was
 * collected from a family so it could be typed into the state's system, and
 * a director reading a value off one window and keying it into another is
 * the tax this product was supposed to remove rather than add. So every
 * field has a copy, and the whole block has one.
 */
function useCopy() {
  const { toast } = useToast();

  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied` });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser refused. Select it and copy by hand.",
        variant: "destructive",
      });
    }
  };
}

/** A quiet copy button that lives inside a field's right-hand edge. */
function CopyButton({
  value,
  label,
  onCopy,
}: {
  value: string;
  label: string;
  onCopy: (text: string, what: string) => void;
}) {
  if (!value) return null;

  return (
    <button
      type="button"
      title={`Copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      onClick={() => onCopy(value, label)}
      className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-md
                 text-muted-foreground/60 transition-colors duration-200
                 hover:text-[var(--accent)]
                 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <ClipboardCopy className="size-3.5" strokeWidth={2} />
    </button>
  );
}

export function VitalsPanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const vitals = useGetVitals(caseId);
  const copy = useCopy();

  const save = useUpdateVitals({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({
          queryKey: getGetVitalsQueryKey(caseId),
        }),
    },
  });

  if (vitals.isPending) {
    return (
      <Loading />
    );
  }

  if (!vitals.data) return null;

  const record = vitals.data as unknown as Record<string, unknown>;
  const missing = vitals.data.missingForFiling;
  const verified = vitals.data.status === "verified";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        {missing.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-[var(--accent-deep)]">
            <Check className="size-4" />
            Everything needed for filing is here.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">Still needed to file: </span>
              <span className="text-muted-foreground">
                {missing.map((field) => LABELS[field] ?? field).join(", ")}
              </span>
            </span>
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {verified
              ? `Verified by ${vitals.data.verifiedByName ?? "staff"}`
              : vitals.data.status === "submitted"
                ? "Family has finished"
                : "Family still filling in"}
          </span>
          {/*
            Everything the family collected, labelled, in the order it is
            asked for. For the director who would rather paste one block into
            a form than press thirty little buttons.
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              copy(
                GROUPS.flatMap((group) =>
                  group.fields
                    .map(([field, label]) => {
                      const value = ((record[field] as string) ?? "").trim();
                      return value ? `${label}: ${value}` : "";
                    })
                    .filter(Boolean),
                ).join("\n"),
                "Everything on file",
              )
            }
          >
            <ClipboardCopy className="size-4" strokeWidth={1.75} />
            Copy it all
          </Button>
          <Button
            variant={verified ? "ghost" : "outline"}
            size="sm"
            onClick={() =>
              save.mutate({ caseId, data: { verified: !verified } })
            }
          >
            {verified ? "Reopen" : "Mark verified"}
          </Button>
        </div>
      </div>

      {verified && (
        <p className="text-sm text-muted-foreground">
          The family can no longer edit these. You still can.
        </p>
      )}

      <SocialSecurityNumber
        caseId={caseId}
        onSave={(digits) =>
          save.mutate({ caseId, data: { socialSecurityNumber: digits } })
        }
        onFile={vitals.data.hasSocialSecurityNumber}
        masked={vitals.data.socialSecurityNumberMasked}
        revealedAt={vitals.data.ssnRevealedAt}
        revealedByName={vitals.data.ssnRevealedByName}
      />

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h3 className="font-display text-base">{group.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map(([field, label]) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field}>{label}</Label>
                <div className="relative">
                  <Input
                    id={field}
                    defaultValue={(record[field] as string) ?? ""}
                    className={`pr-9 ${
                      missing.includes(field) ? "border-[var(--accent)]" : ""
                    }`}
                    onBlur={(event) => {
                      const next = event.target.value.trim();
                      if (next === ((record[field] as string) ?? "")) return;
                      save.mutate({ caseId, data: { [field]: next || null } });
                    }}
                  />
                  <CopyButton
                    value={(record[field] as string) ?? ""}
                    label={label}
                    onCopy={copy}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-1.5">
        <Label htmlFor="staffNotes">Your notes</Label>
        <Textarea
          id="staffNotes"
          rows={3}
          placeholder="What still needs a document, what the registrar queried."
          defaultValue={vitals.data.staffNotes ?? ""}
          onBlur={(event) =>
            save.mutate({
              caseId,
              data: { staffNotes: event.target.value.trim() || null },
            })
          }
        />
      </section>
    </div>
  );
}

/**
 * The social security number: on file, masked, and available in full when
 * somebody says they need it.
 *
 * It used to be masked with no way past. That looked like care and was the
 * opposite: the family had handed the number over, been told the certificate
 * needed it, and then the only way to get it was to telephone a bereaved
 * daughter and ask for her mother's social security number a second time.
 *
 * So there is a button. It is deliberate rather than defended — anybody who
 * can open this case can press it — and what makes that acceptable is that
 * pressing it puts a name and a time on the record, shown here and shown to
 * the family in their own portal. It clears itself after a minute, because
 * the realistic risk to this number is not an attacker, it is a browser left
 * open on a desk in a room where families sit down.
 */
function SocialSecurityNumber({
  caseId,
  onSave,
  onFile,
  masked,
  revealedAt,
  revealedByName,
}: {
  caseId: number;
  onSave: (digits: string) => void;
  onFile: boolean;
  masked: string | null;
  revealedAt: string | Date | null;
  revealedByName: string | null;
}) {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useRevealSocialSecurityNumber({
    mutation: {
      onSuccess: (result) => {
        setShown(result.socialSecurityNumber);
        /*
         * Refetch, so the "last shown to" line below is true the moment it
         * matters rather than on the next page load.
         *
         * Without this a director revealed the number, put it away again,
         * and saw nothing to say anybody had looked — which is exactly the
         * record this feature was built to leave, invisible at the one
         * moment somebody might have checked it.
         */
        void queryClient.invalidateQueries({
          queryKey: getGetVitalsQueryKey(caseId),
        });
      },
    },
  });

  // Off the screen after a minute, and off it on the way out of the tab.
  useEffect(() => {
    if (shown === null) return;

    timer.current = setTimeout(() => setShown(null), 60_000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [shown]);

  const lastLooked =
    revealedAt === null
      ? null
      : new Date(revealedAt).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "numeric",
          minute: "2-digit",
        });

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
      <div className="flex flex-wrap items-start gap-4">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-[var(--accent-deep)]"
          strokeWidth={1.75}
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="ssn">Social security number</Label>

          {shown ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="tabular rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-base font-semibold tracking-[0.08em] text-[var(--accent-deep)]">
                {shown}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(shown, "Social security number")}
              >
                <ClipboardCopy className="size-4" strokeWidth={1.75} />
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShown(null)}>
                Hide
              </Button>
              <span className="text-sm text-muted-foreground">
                Hides itself in a minute.
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {onFile
                ? `On file, ${masked}. Encrypted at rest.`
                : "Not supplied yet."}
            </p>
          )}

          {lastLooked && !shown && (
            <p className="text-sm text-muted-foreground">
              Last shown to {revealedByName ?? "someone here"} on {lastLooked}.
              The family can see this too.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onFile && !shown && (
            <Button
              variant="outline"
              size="sm"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate({ caseId })}
            >
              <Eye className="size-4" strokeWidth={1.75} />
              Show it
            </Button>
          )}

          <Input
            id="ssn"
            className="w-[10rem]"
            inputMode="numeric"
            autoComplete="off"
            placeholder={onFile ? "Replace" : "Add it"}
            onBlur={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              if (digits.length !== 9) return;
              onSave(digits);
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </section>
  );
}
