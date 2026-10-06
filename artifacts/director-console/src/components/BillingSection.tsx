import { PRICE_BOOK, dollars } from "../../../../lib/db/src/price-book";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetBillingQueryKey, useGetBilling } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { BASE_PATH } from "@/lib/base";

/**
 * Subscription state, and two buttons that hand off to Stripe.
 *
 * Nothing about cards, invoices or tax lives here — those are Stripe's pages,
 * which already exist, already handle every currency and every failure, and
 * already produce the receipts a funeral home's accountant asks for.
 */
/**
 * Hand the owner to Stripe, and say so if it could not be done.
 *
 * Shared with the trial banner, whose own copy of this sent the request and
 * then did nothing at all when it failed — a button that silently stopped
 * working on the one day somebody was trying to pay.
 */
export function useBillingHandoff() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const go = async (path: string, extra: Record<string, string> = {}) => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          returnUrl: `${window.location.origin}${BASE_PATH}/settings`,
          ...extra,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        url?: string | null;
        error?: string;
        trialStarted?: boolean;
        trialDaysLeft?: number | null;
      };

      // No Stripe here yet: the button started the free trial in place.
      if (response.ok && payload.trialStarted) {
        await queryClient.invalidateQueries({ queryKey: getGetBillingQueryKey() });
        toast({
          title: "Your free trial is on",
          description: `${payload.trialDaysLeft ?? 30} days with everything included, aftercare too. No card needed.`,
        });
        setBusy(false);
        return;
      }

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not open billing.");
      }

      window.location.href = payload.url;
    } catch (error) {
      toast({
        title: "Couldn't open billing",
        description: error instanceof Error ? error.message : undefined,
        variant: "notice",
      });
      setBusy(false);
    }
  };

  return { busy, go };
}

export function BillingSection({ readOnly }: { readOnly: boolean }) {
  const billing = useGetBilling();
  const { busy, go } = useBillingHandoff();

  if (!billing.data) return null;

  const {
    subscriptionStatus,
    trialDaysLeft,
    currentPeriodEndsAt,
    billingConfigured,
    hasSubscription,
    freeTrialDays,
    trialEnded,
    trialEndsAt,
    annualAvailable,
    checkoutTrialEndsAt,
  } = billing.data;
  const canStartTrial = !billingConfigured && freeTrialDays > 0;
  // When a subscription started now takes its first payment, if not now.
  const firstCharge = checkoutTrialEndsAt
    ? new Date(checkoutTrialEndsAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
      })
    : null;

  const describe = () => {
    switch (subscriptionStatus) {
      case "active":
        return currentPeriodEndsAt
          ? `Active, renewing ${new Date(currentPeriodEndsAt).toLocaleDateString()}.`
          : "Active.";
      case "past_due":
        return "A payment didn't go through. Everything still works — update your card when you can.";
      case "canceled":
        return "Ended. Existing cases stay available; a subscription reopens new ones.";
      default:
        if (trialEnded) {
          return "Your free trial has ended. Everything already here stays available; new cases are paused until you start again.";
        }
        if (hasSubscription) {
          // Subscribed during the trial; Stripe takes the first payment when
          // the free days are over.
          return trialDaysLeft && trialEndsAt
            ? `Subscribed. Free until ${new Date(trialEndsAt).toLocaleDateString()}, when the first payment is taken.`
            : "Subscribed. Your free trial is over and the first payment is being taken.";
        }
        return trialDaysLeft === null
          ? "On a free trial."
          : `On a free trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left, everything included. Nothing disappears when it ends.`;
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-[var(--elevation-1)]">
      <h2 className="font-display text-lg">Subscription</h2>
      <p className="text-sm text-muted-foreground">{describe()}</p>
      <p className="text-sm">
        {dollars(PRICE_BOOK.locationMonthlyCents)} a location a month, plus{" "}
        {dollars(PRICE_BOOK.perFuneralCents)} a funeral served. Aftercare, texts and
        email are included; no activation fee. Annual is two months free.
      </p>

      {canStartTrial && !readOnly && (subscriptionStatus === "canceled" || trialEnded) ? (
        <Button disabled={busy} onClick={() => void go("/api/billing/checkout")}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Start a {freeTrialDays}-day free trial
        </Button>
      ) : !billingConfigured ? (
        <p className="text-sm text-muted-foreground">
          Card billing isn't switched on yet, so nothing is being charged.
        </p>
      ) : readOnly ? (
        <p className="text-sm text-muted-foreground">
          Only an owner can change billing.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hasSubscription ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void go("/api/billing/portal")}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Cards and invoices
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void go("/api/billing/checkout")}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {firstCharge
                  ? `Subscribe monthly — nothing charged until ${firstCharge}`
                  : "Subscribe monthly"}
              </Button>
              {annualAvailable && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void go("/api/billing/checkout", { interval: "year" })}
                >
                  Annual — two months free
                </Button>
              )}
              {subscriptionStatus === "canceled" && (
                // The invoices from the subscription that ended are still
                // the accountant's to download.
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void go("/api/billing/portal")}
                >
                  Past invoices
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
