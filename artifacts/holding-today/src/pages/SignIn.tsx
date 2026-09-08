import { useState } from "react";
import { Link } from "wouter";
import {
  ApiError,
  getGetAuthMethodsQueryKey,
  useGetAuthMethods,
  useLogin,
  useRegister,
} from "@workspace/api-client-react";
import { reloadToHome } from "@/lib/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Heart, Loader2 } from "lucide-react";
import { GoogleButton } from "@/components/GoogleButton";
import { CONTACT_EMAIL } from "@/components/LegalPage";
import { motion } from "framer-motion";

type Mode = "signIn" | "createAccount";

const MIN_PASSWORD_LENGTH = 10;

function status(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

function describeSignInFailure(error: unknown): string {
  // Deliberately the same sentence whether the address is unknown or the
  // password is wrong. The server refuses to tell them apart on purpose —
  // here, confirming an address is registered confirms someone has lost
  // a child — and this page must not undo that by guessing.
  if (status(error) === 401) {
    return "That email and password don't go together. Nothing was wrong with how you typed it — the two just don't match an account here.";
  }
  if (status(error) === 429) {
    return "Too many tries in a row. Give it a few minutes and try again.";
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Something went wrong reaching the site. Please check your connection and try again.";
}

function describeRegisterFailure(error: unknown): string {
  if (status(error) === 409) {
    return "There is already an account with that email address.";
  }
  return describeSignInFailure(error);
}

/**
 * Shown only once something has actually failed, so the front door stays
 * quiet for everyone else.
 *
 * It exists because this page could be a dead end. An account created through
 * Google has no password, and password sign-in refuses it exactly as it
 * refuses an address that was never registered. If that deployment has no
 * Google button — not configured — and no password reset — no mail server —
 * then the person is left with a box that always says no, and nothing else
 * on the screen. The email address is the last route out, and it is written
 * here whatever else is switched on.
 */
function StillStuck({ google }: { google: boolean }) {
  return (
    <div className="mt-5 pt-5 border-t border-white/5 text-sm text-muted-foreground leading-relaxed space-y-2">
      <p className="text-foreground/80">If you can't get in</p>
      {google && (
        <p>
          If you created your account with Google, use the Google button above
          instead — an account made that way has no password to type.
        </p>
      )}
      <p>
        Write to{" "}
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-primary hover:underline break-all"
        >
          {CONTACT_EMAIL}
        </a>{" "}
        from the address you signed up with, and we will get you back in.
        Nothing you have written is lost while you are locked out.
      </p>
    </div>
  );
}

export default function SignIn() {
  const [mode, setMode] = useState<Mode>("signIn");
  const oauthError = new URLSearchParams(window.location.search).get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [problem, setProblem] = useState<string | null>(null);

  const { data: methods } = useGetAuthMethods({
    query: { queryKey: getGetAuthMethodsQueryKey(), retry: false },
  });

  /**
   * Both of these say `shownInPlace`, which stops the app-wide handler from
   * toasting on top of the message this form already shows.
   *
   * A refused sign-in used to be silent: the global handler skips 401s,
   * because everywhere else a 401 means the session quietly ended. Here it
   * means the password was refused, and someone typing a password that keeps
   * not working deserves to be told that is what happened.
   */
  const { mutate: login, isPending: isSigningIn } = useLogin({
    mutation: {
      meta: { shownInPlace: true },
      onError: (error) => setProblem(describeSignInFailure(error)),
    },
  });
  const { mutate: register, isPending: isRegistering } = useRegister({
    mutation: {
      meta: { shownInPlace: true },
      onError: (error) => setProblem(describeRegisterFailure(error)),
    },
  });

  const isPending = isSigningIn || isRegistering;
  const isCreating = mode === "createAccount";

  // Everything cached belongs to whoever was signed in before, so a new
  // session starts the app from scratch rather than from another account's
  // leftovers.
  const onSuccess = () => reloadToHome();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setProblem(null);

    if (isCreating) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setProblem(
          `Please choose a password of at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember works well.`,
        );
        return;
      }

      register(
        {
          data: {
            email,
            password,
            displayName: displayName.trim() || null,
          },
        },
        { onSuccess },
      );
      return;
    }

    login({ data: { email, password } }, { onSuccess });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-secondary border-2 border-primary/30 flex items-center justify-center mb-5 shadow-[0_0_20px_rgba(14,165,233,0.3)]">
            <Heart className="w-7 h-7 text-primary/70" />
          </div>
          <h1 className="font-display text-3xl mb-2">Holding Today</h1>
          <p className="text-muted-foreground text-sm max-w-xs">
            A private place to keep them. Only you can see what you write here.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-6 md:p-8">
          {oauthError && (
            <div className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground/90">
              That didn't work. Please try again, or sign in with your email
              below.
            </div>
          )}

          {methods?.google && (
            <>
              <GoogleButton />
              <p className="text-xs text-muted-foreground/80 text-center mt-3">
                If you signed up with Google, use this button — a Google
                account has no password to type.
              </p>
              <div className="flex items-center gap-3 my-6">
                <span className="h-px flex-1 bg-white/10" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground/70">
                  or
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>
            </>
          )}

          {problem && (
            <div
              role="alert"
              className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground/90"
            >
              {problem}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isCreating && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Your name (optional)</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="name"
                  className="bg-background border-white/10"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="bg-background border-white/10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isCreating ? "new-password" : "current-password"}
                className="bg-background border-white/10"
              />
              {isCreating && (
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={isPending}
              className="w-full mt-2 bg-primary text-primary-foreground rounded-full"
            >
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isCreating ? "Create account" : "Sign in"}
            </Button>
          </form>

          {!isCreating && methods?.passwordReset && (
            <div className="text-center mt-4">
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                I forgot my password
              </Link>
            </div>
          )}

          {problem && <StillStuck google={methods?.google === true} />}

          <div className="mt-6 pt-5 border-t border-white/5 text-center">
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setMode(isCreating ? "signIn" : "createAccount");
              }}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isCreating
                ? "I already have an account"
                : "I'm new here — create an account"}
            </button>
          </div>
        </div>

        <div className="text-center mt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Link>
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6 px-4">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline hover:text-primary">
            terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-primary">
            privacy policy
          </Link>
          .
        </p>

        <p className="text-center text-xs text-muted-foreground/70 mt-4 px-4">
          If you are in crisis, please call or text 988 (US). You are not alone.
        </p>
      </motion.div>
    </div>
  );
}
