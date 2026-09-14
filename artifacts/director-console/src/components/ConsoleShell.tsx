import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Settings,
  LogOut,
  ClipboardList,
  Contact,
  Inbox,
  Home,
  MessageSquare,
  MoreHorizontal,
  Store,
  Tag,
} from "lucide-react";
import {
  useGetIntakeRequests,
  useGetHomeInbox,
  getGetIntakeRequestsQueryKey,
  getGetHomeInboxQueryKey,
} from "@workspace/api-client-react";

/**
 * The frame, and the order of the things in it.
 *
 * Four tabs across the top, and they are the four questions a director
 * actually has: what is waiting on me, who am I burying, who is waiting for
 * an answer, and who asked. Everything that is about the *business* rather
 * than about this week — the public page, the prices, the standard schedule,
 * the staff list — sits behind one more click, because it is opened once a
 * month and a director should not have to read past it every morning.
 */
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

  /* Families waiting on a reply, counted the same gentle way. */
  const inbox = useGetHomeInbox({
    query: {
      queryKey: getGetHomeInboxQueryKey(),
      refetchInterval: 60_000,
      retry: 1,
    },
  });
  const unanswered = (inbox.data ?? []).filter(
    (row) => row.unreadFromFamily > 0,
  ).length;

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        refresh();
        window.location.href = "/";
      },
    },
  });

  const isCases = location === "/cases" || location.startsWith("/cases/");

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
                <Home className="size-4" />
                Today
              </Link>
            </Button>
            <Button asChild variant={isCases ? "secondary" : "ghost"} size="sm">
              <Link href="/cases">
                <ClipboardList className="size-4" />
                Cases
              </Link>
            </Button>
            <Button
              asChild
              variant={location === "/inbox" ? "secondary" : "ghost"}
              size="sm"
            >
              <Link href="/inbox">
                <MessageSquare className="size-4" />
                Messages
                {unanswered > 0 && (
                  <span
                    className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs
                               font-medium text-white"
                  >
                    {unanswered}
                  </span>
                )}
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label="The home">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/storefront">
                    <Store className="size-4" />
                    Your page and policies
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/prices">
                    <Tag className="size-4" />
                    Prices
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/vendors">
                    <Contact className="size-4" />
                    Local network
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="size-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout.mutate()}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</main>
    </div>
  );
}
