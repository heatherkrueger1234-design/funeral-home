import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useVerifyEmail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { AuthPage } from "@/components/AuthPage";
import { useSession } from "@/lib/session";

/**
 * Where a `/verify-email?token=…` link lands.
 *
 * Outside the session gate on purpose, and this is the reason: the email is
 * opened on whichever device it arrived on, which is often a phone the director
 * has never signed in on. A confirmation that first demanded a password is a
 * confirmation that does not happen.
 *
 * It redeems the token on arrival rather than asking anyone to press anything.
 * The person has already agreed to this — they clicked the link — and a second
 * button between them and the only thing this page does would be a step that
 * exists for the software's benefit rather than theirs.
 */
export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const { refresh } = useSession();
  const token =
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("token") ?? "");

  const [state, setState] = useState<"working" | "done" | "failed">(
    token ? "working" : "failed",
  );
  const [problem, setProblem] = useState<string | null>(
    token ? null : "This link is missing its code. Open the email again.",
  );

  const verify = useVerifyEmail({
    mutation: {
      // The failure is shown on the page itself; a toast on top says it twice.
      meta: { handlesOwnErrors: true },
      onSuccess: () => {
        setState("done");
        // A director already signed in on this device would otherwise go on
        // being asked to confirm the address they just confirmed.
        refresh();
      },
      onError: (error: unknown) => {
        setState("failed");
        setProblem(
          error instanceof Error && error.message.trim()
            ? error.message
            : "That link could not be used. Sign in and ask for another.",
        );
      },
    },
  });

  // React 19 in development mounts effects twice, and the token is single-use:
  // without this the second attempt redeems a spent token and the page reports
  // a failure for something that worked.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify.mutate({ data: { token } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (state === "working") {
    return (
      <AuthPage title="One moment">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Confirming your address.
        </p>
      </AuthPage>
    );
  }

  if (state === "done") {
    return (
      <AuthPage
        title="Thank you"
        intro="Your address is confirmed, and the request form on your public page is switched on."
      >
        <Button size="lg" className="w-full" onClick={() => navigate("/")}>
          Open the console
        </Button>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="That link didn't work" intro={problem ?? undefined}>
      <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
        Sign in
      </Button>
    </AuthPage>
  );
}
