import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCertificateFiling,
  useUpdateCertificateFiling,
  getGetCertificateFilingQueryKey,
  getGetHomeDashboardQueryKey,
} from "@workspace/api-client-react";
import type {
  CertificateFiling,
  CertificateFilingUpdate,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingLines } from "@/components/page";
import { cn, fromHomeInput, toHomeInput, zoneHint } from "@/lib/utils";
import { relative, whenLabel } from "@/lib/when";
import { useHomeZone } from "@/lib/session";
import { Check, Clock } from "lucide-react";

/**
 * The death certificate's clock, at the top of the Certificate tab.
 *
 * It leads the tab because it is the question: not what the family has
 * answered but whether this can be filed in time, and when the time runs
 * out. In Colorado that is 72 hours from taking custody, and before
 * disposition (SB 23-020).
 *
 * What a director records here, each a fact only they know: when the home
 * took custody, when the physician was asked through EDRS and when they
 * certified, and when the home filed. We file nothing and hear nothing from the state, and the
 * card says so in its first paragraph -- a director who thought this screen
 * filed a certificate would find out otherwise from the registrar.
 *
 * Overdue is a sentence, in the notice colour, never red. CRAFT.md: the
 * director needs to know where they stand, calmly.
 */
export function CertificateClock({ caseId }: { caseId: number }) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();
  const filing = useGetCertificateFiling(caseId);

  const update = useUpdateCertificateFiling({
    mutation: {
      onSuccess: (saved) => {
        queryClient.setQueryData(getGetCertificateFilingQueryKey(caseId), saved);
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
      },
    },
  });

  const save = (data: CertificateFilingUpdate) => update.mutate({ caseId, data });

  if (filing.isPending) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
        <LoadingLines lines={3} />
      </section>
    );
  }

  // The vitals below still load on their own; a clock that did not load is
  // not a reason to hide the form the family has been filling in.
  if (!filing.data) return null;

  const record = filing.data;
  const filed = record.standing === "filed";
  const late = record.standing === "past_due";

  return (
    <section
      aria-labelledby="certificate-clock"
      className={cn(
        "relative space-y-4 overflow-hidden rounded-xl border bg-card p-5 shadow-[var(--elevation-1)]",
        late ? "border-[var(--notice)]/40" : "border-border",
      )}
    >
      {/* The home's colour when it is in hand, the notice colour when it has
          slipped -- a rule down the edge rather than a wash. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          late ? "bg-[var(--notice)]" : filed ? "bg-[var(--accent)]" : "bg-transparent",
        )}
      />

      <div className="space-y-1.5">
        <h2
          id="certificate-clock"
          className="eyebrow flex items-center gap-1.5"
        >
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
          {record.filingWindowHours
            ? `Filing the certificate · ${record.filingWindowHours} hours from custody`
            : "Filing the certificate"}
        </h2>
        <Headline record={record} zone={zone} />
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {record.filingWindowHours
            ? `${record.stateCode === "CO" ? "Colorado" : "Your state"} gives the home ${record.filingWindowHours} hours from taking custody to file in EDRS, and it has to be before disposition.`
            : "Only Colorado's filing deadline is built in, so no due time is shown for your state. Custody and filing are still recorded here."}{" "}
          This page doesn't file anything and isn't told when you do — it's
          your record of when you did.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <WhenField
          id="custodyTakenAt"
          label="Took custody"
          value={record.custodyTakenAt}
          zone={zone}
          onSave={(custodyTakenAt) => save({ custodyTakenAt })}
          // The common case is recording it as it happens.
          nowLabel="Now"
          disabled={update.isPending}
        />
        <WhenField
          id="physicianRequestedAt"
          label="Physician asked in EDRS"
          value={record.physicianRequestedAt}
          zone={zone}
          onSave={(physicianRequestedAt) => save({ physicianRequestedAt })}
          hint={
            record.physicianDueAt && !record.physicianCertifiedAt
              ? `Their certification is due ${whenLabel(record.physicianDueAt, zone)}.`
              : undefined
          }
          disabled={update.isPending}
        />
        {/*
          The home cannot file until the physician has certified, so this is
          the fact that says whose move it is. Typed from what EDRS shows;
          nothing here is told it.
        */}
        <WhenField
          id="physicianCertifiedAt"
          label="Physician certified"
          value={record.physicianCertifiedAt}
          zone={zone}
          onSave={(physicianCertifiedAt) => save({ physicianCertifiedAt })}
          hint={
            record.physicianRequestedAt && !record.physicianCertifiedAt
              ? "Not yet, as far as this record knows."
              : undefined
          }
          disabled={update.isPending}
        />
        <div className="space-y-1.5">
          <Label htmlFor="certifyingPhysician">Certifying physician</Label>
          <Input
            id="certifyingPhysician"
            key={record.certifyingPhysician ?? ""}
            defaultValue={record.certifyingPhysician ?? ""}
            placeholder="Who to ring if it stalls"
            onBlur={(event) => {
              const next = event.target.value.trim() || null;
              if (next === (record.certifyingPhysician ?? null)) return;
              save({ certifyingPhysician: next });
            }}
          />
        </div>
      </div>

      {zoneHint(zone) && (
        <p className="text-sm text-muted-foreground">{zoneHint(zone)}</p>
      )}

      <div className="flex flex-wrap items-end gap-4 border-t border-border pt-4">
        {filed ? (
          <>
            <WhenField
              id="filedAt"
              label="Filed"
              value={record.filedAt}
              zone={zone}
              onSave={(filedAt) => save({ filedAt })}
              // Clearing it here would reopen the clock by accident; the
              // button beside it is the deliberate way to do that.
              keepWhenEmpty
              disabled={update.isPending}
            />
            <div className="space-y-1.5">
              <Label htmlFor="stateFileNumber">State file number</Label>
              <Input
                id="stateFileNumber"
                className="tabular w-[13rem]"
                key={record.stateFileNumber ?? ""}
                defaultValue={record.stateFileNumber ?? ""}
                placeholder="Once you have one"
                onBlur={(event) => {
                  const next = event.target.value.trim() || null;
                  if (next === (record.stateFileNumber ?? null)) return;
                  save({ stateFileNumber: next });
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => save({ filedAt: null })}
            >
              It isn't filed after all
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={update.isPending}
              onClick={() => save({ filedAt: new Date().toISOString() })}
            >
              <Check className="size-4" aria-hidden />
              I've filed it in EDRS
            </Button>
            <p className="max-w-prose text-sm text-muted-foreground">
              Records it as filed now, in your name. You can correct the time
              afterwards if you filed it earlier.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** One sentence: where this stands, said the way a colleague would say it. */
function Headline({
  record,
  zone,
}: {
  record: CertificateFiling;
  zone: string | undefined;
}) {
  if (record.standing === "filed" && record.filedAt) {
    return (
      <p className="font-display text-lg text-[var(--accent-deep)]">
        Filed {whenLabel(record.filedAt, zone)}
        {record.filedByName ? `, recorded by ${record.filedByName}` : ""}.
      </p>
    );
  }

  if (record.standing === "no_custody") {
    return (
      <p className="font-display text-lg">
        Record when you took custody, and the deadline will appear here.
      </p>
    );
  }

  if (record.standing === "past_due" && record.dueAt) {
    return (
      <p className="font-display text-lg text-[var(--notice)]">
        The {record.filingWindowHours} hours ended {whenLabel(record.dueAt, zone)}.{" "}
        <span className="text-foreground">
          File it as soon as you can, and note why in your notes below.
        </span>
      </p>
    );
  }

  if (record.dueAt) {
    return (
      <p className="font-display text-lg">
        File by {whenLabel(record.dueAt, zone)}{" "}
        <span className="font-sans text-base text-muted-foreground">
          — {relative(record.dueAt, zone)}
        </span>
      </p>
    );
  }

  // Custody recorded in a state whose window we have not checked.
  return (
    <p className="font-display text-lg">
      In your care since {record.custodyTakenAt ? whenLabel(record.custodyTakenAt, zone) : "—"}.
      Not recorded as filed yet.
    </p>
  );
}

/**
 * A time on the home's clock, saved when the box is left.
 *
 * The same rules the service date follows in DetailsPanel: a half-typed
 * picker reports an empty value, which must not save as "cleared", and an
 * unchanged box saves nothing.
 */
function WhenField({
  id,
  label,
  value,
  zone,
  onSave,
  hint,
  nowLabel,
  keepWhenEmpty = false,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  zone: string | undefined;
  onSave: (value: string | null) => void;
  hint?: string;
  nowLabel?: string;
  keepWhenEmpty?: boolean;
  disabled?: boolean;
}) {
  const stored = toHomeInput(value, zone);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="datetime-local"
          className="tabular w-[14.5rem]"
          key={`${value ?? "none"}-${zone ?? ""}`}
          defaultValue={stored}
          onBlur={(event) => {
            if (event.target.validity.badInput) return;
            const typed = event.target.value;
            if (typed === stored) return;
            if (!typed && keepWhenEmpty) {
              event.target.value = stored;
              return;
            }
            onSave(typed ? fromHomeInput(typed, zone) : null);
          }}
        />
        {nowLabel && !value && (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onSave(new Date().toISOString())}
          >
            {nowLabel}
          </Button>
        )}
      </div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}
