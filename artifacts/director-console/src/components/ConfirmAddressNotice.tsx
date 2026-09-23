import { useState } from "react";
import { useResendVerification } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * A line asking a director to confirm the address they registered with.
 *
 * Every rule in the house style applies here and most of them are about what
 * this must not be. Not red — `--destructive` is for destructive confirmation,
 * and this is not a problem the director has caused. No countdown, no "action
 * required", no warning triangle. It says the one thing that is actually true
 * about not confirming, which is narrow: the request form on their public page
 * stays shut. Everything else already works, and saying so is the honest part.
 *
 * It sits above the page rather than interrupting it, and it is dismissable for
 * the session. A director in the middle of Thursday's funeral should be able to
 * put this down.
 */
export function ConfirmAddressNotice() {
  const { session } = useSession();
  const [sent, setSent] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const resend = useResendVerification({
    mutation: { onSuccess: () => setSent(true) },
  });

  if (!session || session.user.emailVerified || dismissed) return null;

  return (
    <div
      className="mx-auto mb-6 w-full max-w-5xl rounded-lg border border-border bg-[var(--muted)]
                 px-4 py-3 text-sm leading-relaxed"
    >
      <p className="text-foreground">
        {sent ? (
          <>
            We've sent a link to <strong>{session.user.email}</strong>. Open it
            when you have a moment, and the request form on your public page
            will be switched on.
          </>
        ) : (
          <>
            When you're ready, confirm <strong>{session.user.email}</strong>.
            It's the one thing that switches on the request form on your public
            page — everything else here already works.
          </>
        )}
      </p>

      {!sent && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {resend.isPending && <Loader2 className="size-4 animate-spin" />}
            Send the link again
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissed(true)}
          >
            Not now
          </Button>
        </div>
      )}
    </div>
  );
}
