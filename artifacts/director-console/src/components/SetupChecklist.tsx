import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetBilling,
  useCompleteOnboardingStep,
  getGetBillingQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Loader2 } from "lucide-react";
import { useBillingHandoff } from "@/components/BillingSection";
import { useSession } from "@/lib/session";

/**
 * What a new home sees instead of an empty console.
 *
 * The trial dies quietly when a director signs up, lands on a blank case
 * list, and cannot tell what they are supposed to do first. Seven steps,
 * ordered by what unblocks the most — open a case and text a family before
 * fiddling with colours, because that is the part families notice and the
 * part that proves the thing works.
 *
 * It disappears on its own once finished, and the steps tick themselves as
 * the work is done, so it is never a second chore.
 */

/**
 * Where each step actually happens.
 *
 * Every step in `ONBOARDING_STEPS` needs an entry. `public` had none, so the
 * one instruction on this list that a director cannot possibly guess — go and
 * find the address of your own page and put it on your website — was the one
 * step with no way through to the screen that holds the address. It is on
 * the storefront page, beside a Copy button, which is exactly where somebody
 * following this list wants to be sent.
 */
const DESTINATIONS: Record<string, string> = {
  // The case list, where both happen. These pointed at "/", which is the
  // page this checklist sits on: pressing the words did nothing at all.
  case: "/cases",
  family: "/cases",
  branding: "/settings",
  hours: "/settings",
  schedule: "/settings",
  staff: "/settings",
  public: "/storefront",
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
    <section className="max-w-2xl rounded-xl border border-border bg-card p-6 shadow-[var(--elevation-1)]">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-xl text-[var(--accent-deep)]">
          Getting set up
        </h2>
        <span className="tabular text-sm text-muted-foreground">
          {billing.data.onboarding.length - remaining.length} of{" "}
          {billing.data.onboarding.length} done
        </span>
      </div>

      {/*
        Held to a reading measure rather than allowed to fill the console.

        Every row used to run the full width of the page, which on a laptop
        put "Go" the better part of a thousand pixels to the right of the
        sentence it belonged to — two separate things to look at instead of
        one instruction. The step is now a single line the eye crosses in one
        go, with its own destination at the end of it, and the panel stops
        where the text does instead of ruling off the whole screen.
      */}
      {/* How far along, as a hairline rather than a number to be read. */}
      <div
        aria-hidden
        className="mb-4 h-[3px] overflow-hidden rounded-full bg-[var(--muted)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-[cubic-bezier(0.2,0.6,0.3,1)]"
          style={{
            width: `${
              ((billing.data.onboarding.length - remaining.length) /
                Math.max(1, billing.data.onboarding.length)) *
              100
            }%`,
          }}
        />
      </div>

      <ul className="space-y-0.5">
        {billing.data.onboarding.map((step) => {
          const destination = DESTINATIONS[step.key];

          return (
            <li key={step.key} className="flex items-start gap-3 -mx-2 px-2 py-1.5">
              <Checkbox
                className="mt-1"
                checked={step.done}
                aria-label={step.title}
                onCheckedChange={(checked) =>
                  update.mutate({ data: { step: step.key, done: checked === true } })
                }
              />

              <span className="min-w-0 flex-1">
                {step.done ? (
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                    {step.title}
                  </span>
                ) : destination ? (
                  /*
                    The title is the link. A director reading "Set your office
                    hours" should be able to act on it by pressing the words
                    they just read, rather than tracking across to a button
                    that repeats nothing about which step it belongs to.
                  */
                  <Link
                    href={destination}
                    className="group inline-flex items-baseline gap-1 font-semibold text-foreground no-underline
                               decoration-[var(--accent)]/40 underline-offset-4 hover:underline"
                  >
                    {step.title}
                    <ArrowRight
                      className="size-3.5 shrink-0 translate-y-px text-[var(--accent)] opacity-0
                                 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]
                                 group-hover:translate-x-0.5 group-hover:opacity-100"
                      strokeWidth={2}
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <span className="font-semibold">{step.title}</span>
                )}

                {!step.done && (
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                    {step.detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
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
  const { session } = useSession();
  const { busy, go } = useBillingHandoff();

  if (!billing.data) return null;

  const { subscriptionStatus, trialDaysLeft, billingConfigured } = billing.data;
  // The server lets only an owner start a subscription; anybody else is told
  // who can, rather than handed a button that fails.
  const isOwner = session?.user.role === "owner";

  const ended = subscriptionStatus === "canceled";
  const closing = subscriptionStatus === "trial" && (trialDaysLeft ?? 99) <= 7;

  if (!ended && !closing) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--notice)]/30 bg-[var(--notice-soft)] px-4 py-3.5">
      <span className="min-w-0 flex-1 text-sm leading-relaxed">
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

      {billingConfigured &&
        (isOwner ? (
          <Button size="sm" disabled={busy} onClick={() => void go("/api/billing/checkout")}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Start a subscription
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            Your home&rsquo;s owner can start one from Settings.
          </span>
        ))}
    </div>
  );
}
