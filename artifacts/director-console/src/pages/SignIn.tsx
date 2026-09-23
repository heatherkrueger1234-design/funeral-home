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
 * The front door, for everybody.
 *
 * Sign-in and opening an account share one screen because a funeral home does
 * this exactly twice — once when they sign up, and every morning after — and
 * a separate marketing-style registration flow would be two pages nobody
 * needs.
 *
 * It also has to be the screen that sorts out who is at the wrong address,
 * because this product is three apps on three hostnames and nobody outside it
 * knows that. A family reaching for their photographs, a director opening the
 * console on a Monday and somebody at the platform looking at customers all
 * arrive with "the link somebody sent me", and two of those three used to hit
 * a sign-in box that could not help them:
 *
 *  - **A family has no password at all**, by design — their texted link is
 *    the credential. Typing an address here would tell them, correctly and
 *    uselessly, that they cannot sign in. So they are pointed at the portal,
 *    which has a box to paste a link into.
 *  - **A platform admin signs in right here**, on the same cookie as any
 *    other staff account, and then needs a different app. The session says
 *    whether the console is theirs, so it can be offered rather than guessed
 *    at.
 */
export default function SignIn() {
  const { toast } = useToast();
  const { refresh } = useSession();
  // `?register` is where the website's "Start a free trial" lands, so a home
  // arriving to sign up is not first shown a sign-in form it has no account for.
  const [mode, setMode] = useState<"signIn" | "register">(() =>
    new URLSearchParams(window.location.search).has("register")
      ? "register"
      : "signIn",
  );

  /*
   * Where the other two apps live, baked in at build time.
   *
   * Empty is a normal state — a dev server, or a deployment that only set the
   * one URL — and every use below is behind a check, because a button reading
   * "Open the platform console" that goes to "/" is worse than no button.
   */
  const familyPortalUrl = (import.meta.env["VITE_FAMILY_PORTAL_URL"] ?? "")
    .toString()
    .replace(/\/+$/, "");
  const adminConsoleUrl = (import.meta.env["VITE_ADMIN_CONSOLE_URL"] ?? "")
    .toString()
    .replace(/\/+$/, "");

  const [homeName, setHomeName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSuccess = (payload: { platformAdmin?: boolean }) => {
    /*
     * Somebody at the platform who signed in here wanted the other console —
     * there is no reason for them to be on this one, and making them find it
     * by typing a second hostname is the sort of small friction that ends in
     * "which address was it again?". Sent straight there when the build knows
     * where it is; when it does not, `refresh()` below still drops them into
     * a working director console rather than nowhere.
     */
    if (payload?.platformAdmin && adminConsoleUrl) {
      window.location.href = adminConsoleUrl;
      return;
    }

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
        <header className="mb-8 text-center">
          <div className="ornament mx-auto mb-5 max-w-[9rem]" aria-hidden>
            <i />
          </div>
          <h1 className="font-display text-[2rem] leading-tight">
            Holding Today
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            The calm side of arrangements, for you and the families you serve.
          </p>
        </header>

        <form
          onSubmit={submit}
          className="engraved space-y-4 rounded-2xl border border-[var(--brass-soft)] bg-card p-7 sm:p-8"
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

        {/*
          The way out for somebody who is not staff at all.

          This is the screen a bereaved family reaches when they open the wrong
          one of three addresses, and the worst thing it could do is sit there
          asking for a password they were never given. They have no account by
          design — the link a funeral home texted them is the credential — so
          this sends them to the portal, which has a box to paste it into.

          Deliberately last, quiet, and in plain words. The person reading it
          may have been told this morning that their mother died, and "Families
          are in a different place" is the sentence that gets them there.
        */}
        {!registering && familyPortalUrl && (
          <p className="mt-7 border-t border-border pt-5 text-center text-sm leading-relaxed text-muted-foreground">
            Were you sent a link by a funeral home?{" "}
            <a
              href={familyPortalUrl}
              className="text-foreground underline decoration-[var(--border-strong)] underline-offset-4
                         transition-colors duration-200 hover:decoration-[var(--accent)]"
            >
              Open it here
            </a>
            . You do not need a password — the link is all you need, and you can
            paste it in on that page.
          </p>
        )}
      </div>
    </div>
  );
}
