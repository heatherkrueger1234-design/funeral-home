import { useState } from "react";
import { useGetBilling } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

/**
 * Subscription state, and two buttons that hand off to Stripe.
 *
 * Nothing about cards, invoices or tax lives here — those are Stripe's pages,
 * which already exist, already handle every currency and every failure, and
 * already produce the receipts a funeral home's accountant asks for.
 */
export function BillingSection({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const billing = useGetBilling();
  const [busy, setBusy] = useState(false);

  if (!billing.data) return null;

  const {
    subscriptionStatus,
    trialDaysLeft,
    currentPeriodEndsAt,
    billingConfigured,
    hasSubscription,
  } = billing.data;

  const go = async (path: string) => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/settings`,
        }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Could not open billing.");
      }

      window.location.href = payload.url;
    } catch (error) {
      toast({
        title: "Couldn't open billing",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
      setBusy(false);
    }
  };

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
        return trialDaysLeft === null
          ? "On trial."
          : `On trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left. Nothing disappears when it ends.`;
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-medium">Subscription</h2>
      <p className="text-sm text-muted-foreground">{describe()}</p>

      {!billingConfigured ? (
        <p className="text-sm text-muted-foreground">
          Billing isn't set up on this deployment, so nothing is being charged.
        </p>
      ) : readOnly ? (
        <p className="text-sm text-muted-foreground">
          Only an owner can change billing.
        </p>
      ) : (
        <div className="flex gap-2">
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
            <Button disabled={busy} onClick={() => void go("/api/billing/checkout")}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Start a subscription
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
