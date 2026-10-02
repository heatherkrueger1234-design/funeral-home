import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDeathCertificate,
  useUpdateDeathCertificate,
  getGetDeathCertificateQueryKey,
  type DeathCertificateInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Clock } from "lucide-react";

/**
 * Colorado's 72-hour clock (SB 23-020): custody starts it, the director
 * files in EDRS and ticks it here. No red: overdue is a sentence, calmly.
 */

/** A Date as the value a datetime-local input wants, in the browser's zone. */
function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function hoursText(hours: number): string {
  const abs = Math.abs(hours);
  const text = abs >= 24 ? `${Math.floor(abs / 24)} d ${Math.round(abs % 24)} h` : `${Math.round(abs)} h`;
  return hours >= 0 ? `${text} left` : `${text} past due`;
}

export function CertificateClock({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const clock = useGetDeathCertificate(caseId);
  const save = useUpdateDeathCertificate({
    mutation: {
      onSuccess: (data) => queryClient.setQueryData(getGetDeathCertificateQueryKey(caseId), data),
    },
  });

  if (!clock.data) return null;
  const c = clock.data;
  const put = (data: DeathCertificateInput) => save.mutate({ caseId, data });
  const moment = (key: "custodyTakenAt" | "edrsRequestedAt" | "certifiedAt", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cert-${key}`}>{label}</Label>
      <Input
        id={`cert-${key}`}
        type="datetime-local"
        defaultValue={toLocalInput(c[key])}
        key={`${key}:${c[key] ?? ""}`}
        onBlur={(event) => {
          const next = event.target.value ? new Date(event.target.value).toISOString() : null;
          if ((next ?? null) !== (c[key] ? new Date(c[key]!).toISOString() : null)) {
            put({ [key]: next });
          }
        }}
      />
    </div>
  );

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg">72-hour filing clock</h2>
        {c.filedAt ? (
          <span className="inline-flex items-center gap-1 text-sm text-[var(--accent-deep)]">
            <Check className="size-4" /> Filed{c.filedByName ? ` by ${c.filedByName}` : ""}
          </span>
        ) : c.hoursRemaining !== null ? (
          <span className="inline-flex items-center gap-1 text-sm font-medium">
            <Clock className="size-4" /> {hoursText(c.hoursRemaining)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Starts when you record custody.</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {moment("custodyTakenAt", "We took custody")}
        {moment("edrsRequestedAt", "Physician asked in EDRS")}
        {moment("certifiedAt", "Physician certified")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cert-provider">Certifying physician</Label>
          <Input
            id="cert-provider"
            defaultValue={c.certifyingProvider ?? ""}
            onBlur={(event) =>
              event.target.value.trim() !== (c.certifyingProvider ?? "") &&
              put({ certifyingProvider: event.target.value })
            }
          />
          {c.certificationDueAt && !c.certifiedAt && (
            <p className="text-sm text-muted-foreground">
              Their 72 hours end {new Date(c.certificationDueAt).toLocaleString()}.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cert-number">State file number</Label>
          <Input
            id="cert-number"
            defaultValue={c.stateFileNumber ?? ""}
            onBlur={(event) =>
              event.target.value.trim() !== (c.stateFileNumber ?? "") &&
              put({ stateFileNumber: event.target.value })
            }
          />
        </div>
      </div>

      {c.missingVitals && c.missingVitals.length > 0 && !c.filedAt && (
        <p className="text-sm">
          <span className="font-medium">Still missing for EDRS: </span>
          {c.missingVitals.length} field{c.missingVitals.length === 1 ? "" : "s"} below.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={c.filedAt ? "outline" : "default"}
          disabled={save.isPending}
          onClick={() => put({ filed: !c.filedAt })}
        >
          {c.filedAt ? "Not filed after all" : "I filed it in EDRS"}
        </Button>
        {c.dueAt && !c.filedAt && (
          <span className="text-sm text-muted-foreground">
            Due {new Date(c.dueAt).toLocaleString()}
          </span>
        )}
      </div>
      <p className="text-xs leading-snug text-muted-foreground">{c.filingNotice}</p>
    </section>
  );
}
