import { useState } from "react";
import { useLogin, useRegisterHome } from "@workspace/api-client-react";
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
    <div className="min-h-dvh grid place-items-center px-5 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl mb-1">Holding Today</h1>
        <p className="text-muted-foreground mb-8">
          The calm side of arrangements, for you and the families you serve.
        </p>

        <form onSubmit={submit} className="space-y-4">
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
              <p className="text-sm text-muted-foreground">
                At least 10 characters. A phrase you'll remember beats
                something clever.
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {registering ? "Open the account" : "Sign in"}
          </Button>
        </form>

        <button
          type="button"
          className="mt-6 w-full text-sm text-muted-foreground underline"
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
