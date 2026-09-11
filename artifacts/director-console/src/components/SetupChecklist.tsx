import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetBilling,
  useCompleteOnboardingStep,
  getGetBillingQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, X } from "lucide-react";

/**
 * What a new home sees instead of an empty console.
 *
 * The trial dies quietly when a director signs up, lands on a blank case
 * list, and cannot tell what they are supposed to do first. Six steps,
 * ordered by what unblocks the most — open a case and text a family before
 * fiddling with colours, because that is the part families notice and the
 * part that proves the thing works.
 *
 * It disappears on its own once finished, and the steps tick themselves as
 * the work is done, so it is never a second chore.
 */

/** Where each step actually happens. */
const DESTINATIONS: Record<string, string> = {
  case: "/",
  family: "/",
  branding: "/settings",
  hours: "/settings",
  schedule: "/settings",
  staff: "/settings",
};

export function SetupChecklist() {
  const queryClient = useQueryClient();
  const billing = useGetBilling();

  const update = useCompleteOnboardingStep({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: getGetBillingQueryKey() }),
    },
  });

  if (!billing.data || billing.data.onboardingComplete) return null;

  const remaining = billing.data.onboarding.filter((step) => !step.done);

  return (
    <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-medium">Getting set up</h2>
        <span className="text-sm text-muted-foreground">
          {billing.data.onboarding.length - remaining.length} of{" "}
          {billing.data.onboarding.length} done
        </span>
      </div>

      <ul className="space-y-2">
        {billing.data.onboarding.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            <Checkbox
              className="mt-0.5 bg-white"
              checked={step.done}
              aria-label={step.title}
              onCheckedChange={(checked) =>
                update.mutate({ data: { step: step.key, done: checked === true } })
              }
            />
            <span className="min-w-0 flex-1">
              <span
                className={
                  step.done ? "line-through text-muted-foreground" : "font-medium"
                }
              >
                {step.title}
              </span>
              {!step.done && (
                <span className="block text-sm text-muted-foreground">
                  {step.detail}
                </span>
              )}
            </span>

            {!step.done && DESTINATIONS[step.key] && (
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link href={DESTINATIONS[step.key]!}>Go</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The trial banner.
 *
 * Shown only in the last stretch, and never as a countdown from day one:
 * a director who has just signed up does not need a clock on the screen while
 * they work their first case. The wording is careful about what actually
 * happens — existing cases and families stay reachable — because implying
 * otherwise would be both untrue and frightening.
 */
export function TrialBanner() {
  const billing = useGetBilling();
  const queryClient = useQueryClient();

  if (!billing.data) return null;

  const { subscriptionStatus, trialDaysLeft, billingConfigured } = billing.data;

  const startCheckout = async () => {
    const response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ returnUrl: window.location.origin + "/settings" }),
    });

    const payload = (await response.json()) as { url?: string; error?: string };
    if (payload.url) window.location.href = payload.url;
    void queryClient;
  };

  const ended = subscriptionStatus === "canceled";
  const closing = subscriptionStatus === "trial" && (trialDaysLeft ?? 99) <= 7;

  if (!ended && !closing) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="min-w-0 flex-1 text-sm">
        {ended ? (
          <>
            <strong>This subscription has ended.</strong> Everything already
            here stays available — you just can't open new cases.
          </>
        ) : trialDaysLeft === 0 ? (
          <>
            <strong>Your trial has finished.</strong> Existing cases and
            families are unaffected; a subscription reopens new ones.
          </>
        ) : (
          <>
            <strong>
              {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left on your
              trial.
            </strong>{" "}
            Nothing disappears when it ends.
          </>
        )}
      </span>

      {billingConfigured && (
        <Button size="sm" onClick={() => void startCheckout()}>
          Start a subscription
        </Button>
      )}
    </div>
  );
}
