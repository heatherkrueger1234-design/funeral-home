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

  const signIn = useMutation({
    mutationFn: () => api.post("/auth/login", { email, password }),
    onSuccess: onSignedIn,
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <h1 className="font-display text-2xl">Holding Today</h1>
        <p className="mt-1 mb-6 text-sm text-[var(--muted-foreground)]">
          The platform console.
        </p>

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
          <Button type="submit" variant="primary" disabled={signIn.isPending}>
            {signIn.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
