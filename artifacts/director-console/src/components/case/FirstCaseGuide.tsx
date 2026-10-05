import { useState } from "react";
import {
  getGetCertificateFilingQueryKey,
  useGetCertificateFiling,
  type CaseDetail,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Check, Circle, X } from "lucide-react";

/**
 * The order most homes work a case in, ticked off from what the case
 * already shows. For a director's first few cases; hidden for good with
 * one click, or once every step is done.
 *
 * Not shown on a plan. Every step after the first hangs off a death — a
 * service date, a custody time, an obituary to sign off for print — and a
 * plan has none of those and nothing due. It appears the day the plan
 * becomes a case.
 */

const STORAGE_KEY = "continuum.firstCaseGuide.hidden";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type Step = { label: string; detail: string; done: boolean; tab: string };

export function FirstCaseGuide({
  detail,
  onOpen,
}: {
  detail: CaseDetail;
  onOpen: (tab: string) => void;
}) {
  const [hidden, setHidden] = useState(readHidden);
  const atNeed = detail.kind !== "pre_need";
  const certificate = useGetCertificateFiling(detail.id, {
    query: { queryKey: getGetCertificateFilingQueryKey(detail.id), enabled: atNeed && !hidden },
  });

  if (hidden || detail.status === "closed" || !atNeed) return null;

  const steps: Step[] = [
    {
      label: "Add the next of kin",
      detail: "They get a private link; text it once they agree to texts.",
      // A live one. On a file that began as a plan the planner is still on
      // the list, with their link closed, and is nobody's next of kin now.
      done: detail.contacts.some(
        (contact) => contact.role === "next_of_kin" && contact.revokedAt === null,
      ),
      tab: "family",
    },
    {
      label: "Set the service date",
      detail: "The family's timeline and your reminders hang off it.",
      done: detail.serviceAt !== null,
      tab: "service",
    },
    ...(atNeed
      ? [
          {
            label: "Record when you took custody",
            detail: "Starts the death certificate's filing clock (72 hours in Colorado).",
            done: Boolean(certificate.data?.custodyTakenAt),
            tab: "vitals",
          },
        ]
      : []),
    {
      label: "Photographs",
      detail: "The family adds them from their phones; you pick the portrait.",
      done: detail.photoCount > 0,
      tab: "photos",
    },
    {
      label: "Approve the obituary",
      detail: "The family writes it; you check and sign it off for print.",
      done: detail.obituaryStatus === "approved",
      tab: "obituary",
    },
  ];

  if (steps.every((step) => step.done)) return null;
  const next = steps.find((step) => !step.done);

  return (
    <section
      aria-label="Getting this case done"
      className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4"
    >
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm font-medium text-[var(--accent-deep)]">
          The usual order — {steps.filter((s) => s.done).length} of {steps.length} done
        </p>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Hide this guide"
          onClick={() => {
            try {
              window.localStorage.setItem(STORAGE_KEY, "1");
            } catch {
              /* private window: hidden for this visit only */
            }
            setHidden(true);
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.label}>
            <button
              type="button"
              onClick={() => onOpen(step.tab)}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-card ${
                step === next ? "bg-card shadow-[var(--elevation-1)]" : ""
              }`}
            >
              {step.done ? (
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent-deep)]" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span>
                <span className={`block ${step.done ? "text-muted-foreground line-through" : "font-medium"}`}>
                  {step.label}
                </span>
                {!step.done && (
                  <span className="block text-muted-foreground">{step.detail}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        After the service, close the case and the family is offered aftercare.
      </p>
    </section>
  );
}
