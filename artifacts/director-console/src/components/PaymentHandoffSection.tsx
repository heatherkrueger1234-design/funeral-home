import { useState } from "react";
import {
  usePaymentHandoff,
  usePutPaymentHandoff,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

/**
 * Where families are sent to settle a statement.
 *
 * **We do not take the money, and this section is the whole of why.** There is
 * no processor here, no account to connect, no funds held and no card detail
 * stored — the family is shown their itemised total and a link to the page the
 * home already has, at the home's own processor, under the home's own merchant
 * account. Chargebacks, refunds and reconciliation stay where the relationship
 * and the bookkeeping already are.
 *
 * The copy says that out loud rather than leaving a director to assume
 * otherwise, because a director who believes we are collecting for them is a
 * director who stops chasing a payment that never arrived.
 */
export function PaymentHandoffSection({ readOnly }: { readOnly: boolean }) {
  const handoff = usePaymentHandoff();
  const save = usePutPaymentHandoff();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  if (handoff.isPending) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  const row = handoff.data;

  const put = (values: {
    paymentPageUrl?: string | null;
    otherWaysToPay?: string | null;
  }) => {
    setError(null);
    save.mutate(values, {
      onError: (err: unknown) => {
        // The server's own sentence, which explains what is wrong with the
        // address. Better than anything this component could invent.
        const detail =
          err && typeof err === "object" && "data" in err
            ? (err as { data?: { error?: string } }).data?.error
            : undefined;

        setError(detail ?? "That didn't save. Please try again.");
      },
      onSuccess: () => toast({ title: "Saved" }),
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-medium">Taking payment</h2>
        <p className="text-sm text-muted-foreground">
          We never take a payment and never see a card. When you confirm a
          statement, the family is shown their total and sent here — your page,
          your processor, your account, exactly as it works now.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paymentPageUrl">Your payment page</Label>
        <Input
          id="paymentPageUrl"
          type="url"
          inputMode="url"
          disabled={readOnly}
          defaultValue={row?.url ?? ""}
          placeholder="https://www.yourfuneralhome.com/pay"
          onBlur={(event) => {
            const value = event.target.value.trim() || null;
            if (value !== (row?.url ?? null)) put({ paymentPageUrl: value });
          }}
        />
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            The families are shown {row?.host ? `"${row.host}"` : "the website name"}{" "}
            beside the link, so they can see it is yours before they click.
            Leave it blank and they are given your telephone number instead.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="otherWaysToPay">Other ways you'll take it</Label>
        <Textarea
          id="otherWaysToPay"
          rows={3}
          disabled={readOnly}
          defaultValue={row?.otherWaysToPay ?? ""}
          placeholder="Or bring a check to the office on Main Street — we're open until five."
          onBlur={(event) => {
            const value = event.target.value.trim() || null;
            if (value !== (row?.otherWaysToPay ?? null)) {
              put({ otherWaysToPay: value });
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          In your own words, printed on the statement and shown to the family.
          Plenty of families would rather post a check or telephone.
        </p>
      </div>
    </section>
  );
}
