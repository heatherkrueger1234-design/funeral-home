import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
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
import { cn } from "@/lib/utils";
import {
  useGetIntakeRequests,
  useGetHomeInbox,
  getGetIntakeRequestsQueryKey,
  getGetHomeInboxQueryKey,
} from "@workspace/api-client-react";

/**
 * The frame. Four places to be, a drawer for the rest, and a way out.
 *
 * Sticky, because a director keeps this open all day and scrolls a long
 * worklist; the home's name and the waiting counts should not be something
 * they have to scroll back up to find.
 *
 * The four across the top are the four questions a director actually has on a
 * Tuesday: what is waiting on me, who am I burying, who is waiting for an
 * answer, and who asked. Everything about the *business* rather than about
 * this week — the public page, the prices, the local network, the standard
 * schedule — sits one click further in, because it is opened about once a
 * month and should not have to be read past every morning.
 */

const PLACES = [
  { href: "/", label: "Today", icon: Home },
  { href: "/cases", label: "Cases", icon: ClipboardList },
  { href: "/inbox", label: "Messages", icon: MessageSquare },
  { href: "/requests", label: "Requests", icon: Inbox },
] as const;

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: typeof ClipboardList;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold no-underline",
        "transition-colors duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-deep)]"
          : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} />
      <span className="hidden sm:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="tabular rounded-full bg-[var(--notice)] px-1.5 py-0.5 text-xs font-semibold text-white"
          title={`${badge} waiting`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

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

  /* A case's own page is still "Cases" as far as the nav is concerned. */
  const isActive = (href: string) =>
    href === "/cases"
      ? location === "/cases" || location.startsWith("/cases/")
      : location === href;

  const badgeFor = (href: string) =>
    href === "/requests" ? waiting : href === "/inbox" ? unanswered : undefined;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm supports-[backdrop-filter]:bg-card/85">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-2.5">
          <Link
            href="/"
            className="truncate font-display text-lg leading-tight no-underline"
          >
            {session?.home.name ?? "Console"}
          </Link>

          {/* A hairline between whose console this is and what is in it. */}
          <span className="hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden />

          <nav aria-label="Sections" className="ml-auto flex items-center gap-1">
            {PLACES.map((place) => (
              <NavLink
                key={place.href}
                {...place}
                active={isActive(place.href)}
                badge={badgeFor(place.href)}
              />
            ))}

            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="The home"
                  title="The home"
                  className="inline-flex min-h-9 items-center rounded-md px-2 text-muted-foreground
                             transition-colors duration-200 hover:bg-[var(--muted)] hover:text-foreground
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/storefront" className="no-underline">
                    <Store className="size-4" strokeWidth={1.75} />
                    Your page and policies
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/prices" className="no-underline">
                    <Tag className="size-4" strokeWidth={1.75} />
                    Prices
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/vendors" className="no-underline">
                    <Contact className="size-4" strokeWidth={1.75} />
                    Local network
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="no-underline">
                    <Settings className="size-4" strokeWidth={1.75} />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout.mutate()}>
                  <LogOut className="size-4" strokeWidth={1.75} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-7">{children}</main>
    </div>
  );
}
