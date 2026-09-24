import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVitals,
  useUpdateVitals,
  getGetVitalsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";
import { LoadFailed, Loading } from "@/components/page";

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

/** What the case already knows that the certificate asks for again. */
type FromCase = {
  legalFirstName: string;
  legalLastName: string;
  dateOfBirth: string | null;
};

export function VitalsPanel({
  caseId,
  fromCase,
}: {
  caseId: number;
  fromCase: FromCase;
}) {
  const queryClient = useQueryClient();
  const vitals = useGetVitals(caseId);
  const [ssnProblem, setSsnProblem] = useState(false);

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

  if (!vitals.data) {
    return (
      <LoadFailed what="The certificate details" onRetry={() => void vitals.refetch()} />
    );
  }

  const record = vitals.data as unknown as Record<string, unknown>;

  /*
   * Never ask twice. The name and date of birth were typed when the case
   * was opened; the certificate asked for them again from blank. Offered
   * rather than copied silently, because the legal name on a certificate is
   * sometimes not the one the family uses.
   */
  const fill = Object.fromEntries(
    (Object.entries(fromCase) as Array<[keyof FromCase, string | null]>).filter(
      ([field, value]) => value && !record[field],
    ),
  );
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
          <Button
            variant={verified ? "ghost" : "outline"}
            size="sm"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ caseId, data: { verified: !verified } })
            }
          >
            {verified ? "Reopen" : "Mark verified"}
          </Button>
        </div>
      </div>

      {Object.keys(fill).length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-[var(--sunken)] px-4 py-3">
          <p className="min-w-0 flex-1 text-sm leading-snug text-muted-foreground">
            The case already has{" "}
            {[
              fill.legalFirstName || fill.legalLastName ? "the name" : null,
              fill.dateOfBirth ? "the date of birth" : null,
            ]
              .filter(Boolean)
              .join(" and ")}
            . Check it is the legal one before filing.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate({ caseId, data: fill })}
          >
            Fill in from the case
          </Button>
        </div>
      )}

      {verified && (
        <p className="text-sm text-muted-foreground">
          The family can no longer edit these. You still can.
        </p>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <ShieldCheck className="mb-2 size-5 text-[var(--accent-deep)]" />
        <div className="space-y-1.5">
          <Label htmlFor="ssn">Social security number</Label>
          <p className="text-sm text-muted-foreground">
            {vitals.data.hasSocialSecurityNumber
              ? `On file, ${vitals.data.socialSecurityNumberMasked}. Encrypted — the full number is never shown.`
              : "Not supplied yet."}
          </p>
        </div>
        <Input
          id="ssn"
          className="w-[11rem]"
          inputMode="numeric"
          autoComplete="off"
          placeholder={vitals.data.hasSocialSecurityNumber ? "Replace" : "123-45-6789"}
          aria-invalid={ssnProblem || undefined}
          aria-describedby={ssnProblem ? "ssn-problem" : undefined}
          onChange={() => setSsnProblem(false)}
          onBlur={(event) => {
            const digits = event.target.value.replace(/\D/g, "");
            // Anything but nine digits used to vanish without a word, and the
            // director believed it was on file.
            if (digits.length === 0) return;
            if (digits.length !== 9) {
              setSsnProblem(true);
              return;
            }
            save.mutate({ caseId, data: { socialSecurityNumber: digits } });
            event.target.value = "";
          }}
        />
        {ssnProblem && (
          <p id="ssn-problem" role="alert" className="basis-full text-sm text-foreground">
            A social security number is nine digits. Nothing has been saved yet.
          </p>
        )}
      </section>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h3 className="font-display text-base">{group.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.fields.map(([field, label]) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field}>{label}</Label>
                <Input
                  id={field}
                  // Keyed by the stored value, so "Fill in from the case"
                  // shows up in the boxes it filled.
                  key={`${field}:${(record[field] as string) ?? ""}`}
                  // A date picker, as the family has — unless an older record
                  // holds the date as words, which a picker would hide.
                  type={
                    field === "dateOfBirth" &&
                    /^(\d{4}-\d{2}-\d{2})?$/.test((record[field] as string) ?? "")
                      ? "date"
                      : undefined
                  }
                  defaultValue={(record[field] as string) ?? ""}
                  className={
                    missing.includes(field) ? "border-[var(--accent)]" : ""
                  }
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next === ((record[field] as string) ?? "")) return;
                    save.mutate({ caseId, data: { [field]: next || null } });
                  }}
                />
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
