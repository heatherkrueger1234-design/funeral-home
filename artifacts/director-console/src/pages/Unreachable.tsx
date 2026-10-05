import { Loader2, RotateCcw } from "lucide-react";
import { AuthPage } from "@/components/AuthPage";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

/**
 * The console could not ask the server who is here: the API restarting, or
 * the office connection dropping. Said as that, with the one thing to do
 * about it, rather than as the sign-in form -- which told a director they
 * had been signed out, and asked for a password that a server which was
 * not answering could not check.
 */
export default function Unreachable() {
  const { refresh, asking } = useSession();

  return (
    <AuthPage
      title="We can't reach the server"
      intro="This is usually the connection, or the system restarting for a moment. Nothing has been lost."
    >
      <Button type="button" className="w-full" disabled={asking} onClick={refresh}>
        {asking ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-4" aria-hidden />
        )}
        Try again
      </Button>
    </AuthPage>
  );
}
