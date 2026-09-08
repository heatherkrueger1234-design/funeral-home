import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Heart, Loader2, MailCheck } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { mutate: forgotPassword, isPending } = useForgotPassword();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // The server answers the same way whether or not an account exists, so
    // this screen does too — anything else would let someone use this page to
    // find out who has an account here.
    forgotPassword({ data: { email } }, { onSettled: () => setSent(true) });
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
            {sent ? (
              <MailCheck className="w-7 h-7 text-primary/70" />
            ) : (
              <Heart className="w-7 h-7 text-primary/70" />
            )}
          </div>
          <h1 className="font-display text-2xl md:text-3xl mb-2">
            {sent ? "Check your email" : "Reset your password"}
          </h1>
        </div>

        <div className="glass-panel rounded-2xl p-6 md:p-8">
          {sent ? (
            <div className="space-y-4 text-muted-foreground text-sm leading-relaxed">
              <p>
                If there is an account for that address, a link is on its way.
                It works once and expires in an hour.
              </p>
              <p>
                Nothing you have written has changed, and nothing is lost. If
                the email does not arrive, check your spam folder — and you can
                ask for another one.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSent(false)}
                className="rounded-full mt-2"
              >
                Send another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Enter the email you signed up with and we will send you a link
                to choose a new password.
              </p>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-background border-white/10"
                />
              </div>
              <Button
                type="submit"
                disabled={isPending}
                className="w-full mt-2 bg-primary text-primary-foreground rounded-full"
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Send the link
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
