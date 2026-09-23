import { useState } from "react";
import {
  useForgotPassword,
  useLogin,
  useRegisterHome,
} from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

/**
 * The front door.
 *
 * Sign-in and opening an account share one screen because a funeral home does
 * this exactly twice — once when they sign up, and every morning after — and
 * a separate marketing-style registration flow would be two pages nobody
 * needs.
 */
export default function SignIn() {
  const { toast } = useToast();
  const { refresh } = useSession();
  const [mode, setMode] = useState<"signIn" | "register">("signIn");

  const [homeName, setHomeName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSuccess = () => {
    refresh();
  };

  const onError = (error: unknown) => {
    toast({
      title: mode === "signIn" ? "Couldn't sign in" : "Couldn't open the account",
      description:
        error instanceof Error ? error.message : "Please try that again.",
      variant: "destructive",
    });
  };

  const login = useLogin({ mutation: { onSuccess, onError } });
  const register = useRegisterHome({ mutation: { onSuccess, onError } });

  /*
   * The way back in. The endpoint and the email have existed all along; there
   * was simply nothing anywhere that asked for one, so a director who forgot
   * their password had no route that did not involve reading a server log.
   *
   * Answers the same way whether or not the address is known, because the
   * endpoint does — and because "no account here" is a fact about somebody's
   * staff list that a stranger typing addresses should not be able to collect.
   */
  const forgot = useForgotPassword({
    mutation: {
      onSuccess: () =>
        toast({
          title: "Check your email",
          description:
            "If that address has an account, a link to choose a new password " +
            "is on its way. It lasts an hour.",
        }),
      onError,
    },
  });

  const pending = login.isPending || register.isPending;
  const registering = mode === "register";

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();

    if (registering) {
      register.mutate({
        data: {
          homeName: homeName.trim(),
          email: email.trim(),
          password,
          displayName: displayName.trim() || null,
        },
      });
    } else {
      login.mutate({ data: { email: email.trim(), password } });
    }
  }

  return (
    /*
      The only screen in the product with nothing else on it, so it is allowed
      to be composed as a page rather than as a form: the name set above the
      card in the serif, the work inside it. A sign-in box floating in the
      middle of an empty page is what a scaffold looks like.
    */
    <div className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-7 text-center">
          <h1 className="font-display text-[1.75rem] leading-tight">
            Holding Today
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            The calm side of arrangements, for you and the families you serve.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--elevation-2)] sm:p-7"
        >
          {registering && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="homeName">Funeral home</Label>
                <Input
                  id="homeName"
                  required
                  value={homeName}
                  onChange={(event) => setHomeName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Your name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={registering ? "new-password" : "current-password"}
              required
              minLength={registering ? 10 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {registering && (
              <p className="text-sm leading-snug text-muted-foreground">
                At least 10 characters. A phrase you'll remember beats
                something clever.
              </p>
            )}
          </div>

          <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {registering ? "Open the account" : "Sign in"}
          </Button>
        </form>

        {!registering && (
          <button
            type="button"
            className="mt-4 w-full rounded-md py-2 text-sm text-muted-foreground underline
                       decoration-[var(--border-strong)] underline-offset-4
                       transition-colors duration-200 hover:text-foreground hover:decoration-[var(--accent)]
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            disabled={forgot.isPending}
            onClick={() => {
              const address = email.trim();
              if (!address) {
                toast({
                  title: "Which address?",
                  description:
                    "Put your email in above and we'll send a link to it.",
                });
                return;
              }
              forgot.mutate({ data: { email: address } });
            }}
          >
            I've forgotten my password
          </button>
        )}

        <button
          type="button"
          className="mt-2 w-full rounded-md py-2 text-sm text-muted-foreground underline
                     decoration-[var(--border-strong)] underline-offset-4
                     transition-colors duration-200 hover:text-foreground hover:decoration-[var(--accent)]
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          onClick={() => setMode(registering ? "signIn" : "register")}
        >
          {registering
            ? "We already have an account"
            : "Set up a new funeral home"}
        </button>
      </div>
    </div>
  );
}
