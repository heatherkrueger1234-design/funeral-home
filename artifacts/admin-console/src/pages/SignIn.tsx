import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, Field } from "@/components/ui";

/**
 * The front door.
 *
 * The same account and the same cookie as the director console — a platform
 * admin is a signed-in staff member who is also on the platform list, so
 * there is one way in to this application and not two. Nothing here says so;
 * somebody who is not a platform admin simply gets told, once and without
 * detail, that there is nothing here for them.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  /* Baked in at build time; empty on a dev server, and the link below is
   * behind a check because one that goes nowhere is worse than none. */
  const consoleUrl = (import.meta.env["VITE_CONSOLE_URL"] ?? "")
    .toString()
    .replace(/\/+$/, "");

  const signIn = useMutation({
    mutationFn: () => api.post("/auth/login", { email, password }),
    onSuccess: onSignedIn,
  });

  return (
    <div className="mx-auto grid min-h-dvh max-w-sm place-items-center px-6 py-12">
      <div className="w-full">
        <header className="mb-7 text-center">
          <h1 className="font-display text-[1.75rem] leading-tight">
            Continuum Aftercare
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
            The platform console.
          </p>
        </header>

        <Card className="w-full shadow-[var(--elevation-2)]">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            signIn.mutate();
          }}
        >
          <Field
            label="Email address"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            problem={
              signIn.error instanceof Error ? signIn.error.message : undefined
            }
          />
          <Button
            type="submit"
            variant="primary"
            className="mt-1 w-full"
            disabled={signIn.isPending}
          >
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        </Card>

        {/*
          For whoever opened the wrong address.

          This console is for the vendor's own staff, and a funeral director
          who lands on it can sign in successfully and then be told there is
          nothing here for them — which reads as a broken account rather than
          a wrong turn. Naming the other app costs nothing and discloses
          nothing: the console's hostname is already public to anyone who can
          read a certificate log.
        */}
        {consoleUrl && (
          <p className="mt-7 border-t border-[var(--border)] pt-5 text-center text-sm leading-relaxed text-[var(--muted-foreground)]">
            Work at a funeral home?{" "}
            <a
              href={consoleUrl}
              className="text-[var(--foreground)] underline underline-offset-4"
            >
              Your console is here
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
