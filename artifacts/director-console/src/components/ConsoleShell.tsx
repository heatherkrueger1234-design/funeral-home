import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, ClipboardList, Contact } from "lucide-react";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { session, refresh } = useSession();
  const [location] = useLocation();

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
