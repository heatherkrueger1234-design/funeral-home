import { useState } from "react";
import { useLocation } from "wouter";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { AuthPage } from "@/components/AuthPage";

/**
 * Where a `/reset-password?token=…` link lands.
 *
 * Three separate emails have pointed at this path since before there was a
 * page here, which meant all three did nothing: a director who forgot their
 * password could not reset it, and — worse, because it is silent — every staff
 * invitation was dead. `POST /home/staff` and the admin console's own
 * home-creation both send somebody here to choose their first password, so
 * until this existed a funeral home could not add a second employee at all.
 *
 * One page for both, because to the person reading the email they are the same
 * task: you have a link, you choose a password, you are in. What differs is the
 * sentence above the field, and that comes off the URL.
 */
export default function ChoosePassword() {
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.search,
  );
  const token = params.get("token") ?? "";
  // Set by the invitation emails, so a new member of staff is not told their
  // password was "reset" on an account they have never signed in to.
  const invited = params.get("invited") === "1";

  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = useResetPassword({
    mutation: {
      // The failure is shown on the page itself; a toast on top says it twice.
      meta: { handlesOwnErrors: true },
      onSuccess: () => setDone(true),
      onError: (error: unknown) =>
        setProblem(
          error instanceof Error && error.message.trim()
            ? error.message
            : "That link could not be used. Ask for another and try again.",
        ),
    },
  });

  void location;

  if (!token) {
    return (
      <AuthPage
        title={invited ? "Choose your password" : "Choose a new password"}
        intro="This link is missing its code. Open the most recent email again, or ask for another."
      >
        <Button variant="outline" className="w-full" onClick={() => navigate("/")}>
          Back to sign in
        </Button>
      </AuthPage>
    );
  }

  if (done) {
    return (
      <AuthPage
        title="That's set"
        intro="You can sign in with your new password now."
      >
        <Button size="lg" className="w-full" onClick={() => navigate("/")}>
          Sign in
        </Button>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title={invited ? "Choose your password" : "Choose a new password"}
      intro={
        invited
          ? "One password and you're in. Ten characters or more — a phrase you'll remember beats something clever."
          : "Ten characters or more. A phrase you'll remember beats something clever."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setProblem(null);
          reset.mutate({ data: { token, password } });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {problem && (
          <p
            role="alert"
            className="text-sm leading-snug text-muted-foreground"
          >
            {problem}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={reset.isPending}
        >
          {reset.isPending && <Loader2 className="size-4 animate-spin" />}
          Save this password
        </Button>
      </form>
    </AuthPage>
  );
}
