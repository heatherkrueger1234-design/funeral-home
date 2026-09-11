import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, ClipboardList, Contact, Inbox } from "lucide-react";
import {
  useGetIntakeRequests,
  getGetIntakeRequestsQueryKey,
} from "@workspace/api-client-react";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const [location] = useLocation();

  /*
   * Polled rather than pushed, and gently: a request is somebody waiting for
   * a telephone call, so a director must not have to open the page to find
   * out one arrived — but nothing here is so urgent that it justifies a
   * socket, and a console left open all day should not chatter.
   */
  const pending = useGetIntakeRequests(
    { status: "pending" },
    {
      query: {
        queryKey: getGetIntakeRequestsQueryKey({ status: "pending" }),
        refetchInterval: 60_000,
        retry: 1,
      },
    },
  );
  const waiting = pending.data?.length ?? 0;

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        refresh();
        window.location.href = "/";
      },
    },
  });

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-5 py-3">
          <Link href="/" className="font-display text-lg leading-tight">
            {session?.home.name ?? "Console"}
          </Link>

          <nav className="ml-auto flex items-center gap-1">
            <Button
              asChild
              variant={location === "/" ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href="/">
                <ClipboardList className="size-4" />
                Cases
              </Link>
            </Button>
            <Button
              asChild
              variant={location === "/requests" ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href="/requests">
                <Inbox className="size-4" />
                Requests
                {waiting > 0 && (
                  <span
                    className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs
                               font-medium text-white"
                  >
                    {waiting}
                  </span>
                )}
              </Link>
            </Button>
            <Button
              asChild
              variant={location === "/vendors" ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href="/vendors">
                <Contact className="size-4" />
                Local
              </Link>
            </Button>
            <Button
              asChild
              variant={location === "/settings" ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href="/settings">
                <Settings className="size-4" />
                Settings
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => logout.mutate()}
            >
              <LogOut className="size-4" />
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
    </div>
  );
}
