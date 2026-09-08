import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CheckCircle2, Heart, Loader2 } from "lucide-react";

const MIN_PASSWORD_LENGTH = 10;

export default function ResetPassword() {
  // The token arrives in the link from the email, not from the router, so it
  // is read straight off the query string.
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [done, setDone] = useState(false);
  const { toast } = useToast();
  const { mutate: resetPassword, isPending } = useResetPassword();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast({
        title: "Please choose a longer password",
        description: `At least ${MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember works well.`,
        variant: "destructive",
      });
      return;
    }

    resetPassword(
      { data: { token, newPassword } },
      { onSuccess: () => setDone(true) },
    );
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
            {done ? (
              <CheckCircle2 className="w-7 h-7 text-primary/70" />
            ) : (
              <Heart className="w-7 h-7 text-primary/70" />
            )}
          </div>
          <h1 className="font-display text-2xl md:text-3xl">
            {done ? "Password changed" : "Choose a new password"}
          </h1>
        </div>

        <div className="glass-panel rounded-2xl p-6 md:p-8">
          {done ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                You can sign in with it now. Everything you have written is
                exactly where you left it.
              </p>
              <Link href="/signin">
                <Button className="w-full bg-primary text-primary-foreground rounded-full">
                  Sign in
                </Button>
              </Link>
            </div>
          ) : !token ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This link is missing its code. Please open the link from your
                email again, or ask for a new one.
              </p>
              <Link href="/forgot-password">
                <Button variant="secondary" className="w-full rounded-full">
                  Send a new link
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-background border-white/10"
                />
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>
              <Button
                type="submit"
                disabled={isPending}
                className="w-full mt-2 bg-primary text-primary-foreground rounded-full"
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save new password
              </Button>
            </form>
          )}
        </div>

        <div className="text-center mt-6">
          <Link
            href="/signin"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
