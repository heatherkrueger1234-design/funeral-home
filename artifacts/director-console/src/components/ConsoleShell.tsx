import { useEffect, useRef, useState, type ReactNode } from "react";
import { useIsMutating, useMutationState } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useLogout } from "@workspace/api-client-react";
import { useSession } from "@/lib/session";
import { ConfirmAddressNotice } from "@/components/ConfirmAddressNotice";
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
import { BASE_PATH } from "@/lib/base";
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
        "relative inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold no-underline",
        "transition-colors duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
        // The same rule the case tabs use for their live tab: a line in the
        // home's colour, not a wash so faint it reads the same as "off" on a
        // near-white header.
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-deep)] shadow-[inset_0_-2px_0_0_var(--accent)]"
          : "text-muted-foreground hover:bg-[var(--muted)] hover:text-foreground",
      )}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      {/* Visually hidden on a phone, never removed: `hidden` took the only
          name these links had, so a screen reader announced four unlabelled
          links in a row at exactly the width a director uses at a graveside. */}
      <span className="sr-only sm:not-sr-only">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          className="tabular rounded-full bg-[var(--notice)] px-1.5 py-0.5 text-xs font-semibold text-white"
          title={`${badge} waiting`}
        >
          <span className="sr-only">, </span>
          {badge}
          <span className="sr-only"> waiting</span>
        </span>
      )}
    </Link>
  );
}

/**
 * "Saving…" and then "Saved", in the bar, for a moment.
 *
 * Almost every field in this console saves itself when the cursor leaves it,
 * which is right for somebody typing between telephone calls — and was
 * silent, so nobody could tell whether the date they had just corrected had
 * gone anywhere. This is the one confirmation for all of them: quiet, in the
 * same place every time, and gone after two seconds. A failure is not shown
 * here; it gets a message of its own that says what to do.
 */
function SaveStatus() {
  const saving = useIsMutating();
  const lastStatus = useMutationState({
    select: (mutation) => mutation.state.status,
  }).at(-1);
  const [shown, setShown] = useState<"saving" | "saved" | null>(null);
  const wasSaving = useRef(false);

  useEffect(() => {
    if (saving > 0) {
      wasSaving.current = true;
      setShown("saving");
      return;
    }
    if (!wasSaving.current) return;
    wasSaving.current = false;
    if (lastStatus !== "success") {
      setShown(null);
      return;
    }
    setShown("saved");
    const timer = window.setTimeout(() => setShown(null), 2000);
    return () => window.clearTimeout(timer);
  }, [saving, lastStatus]);

  return (
    <span
      role="status"
      aria-live="polite"
      className="hidden min-w-[4.5rem] text-right text-xs text-muted-foreground sm:block"
    >
      {shown === "saving" ? "Saving…" : shown === "saved" ? "Saved" : ""}
    </span>
  );
}

/**
 * One letter for the monogram: the first letter of the first word that is
 * not an article, so "The Willowbank Funeral Home" is W rather than T.
 */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  const word = words.find((w) => !/^(the|a|an)$/i.test(w)) ?? words[0] ?? "";
  return word.charAt(0).toUpperCase();
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
  /*
   * Families the home can still answer. A locked thread takes nothing from
   * either side, so an unread message behind one is not a badge anybody can
   * clear — and a number that never goes down is a number people stop
   * reading. The dashboard tile counts the same way.
   *
   * Waiting means the family spoke last, not that nobody has opened it:
   * reading a message on the way out of the door is not answering it.
   */
  const unanswered = (inbox.data ?? []).filter(
    (row) => row.waitingOnReply && !row.locked,
  ).length;

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        refresh();
        window.location.href = `${BASE_PATH}/`;
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
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 shadow-[0_1px_0_rgb(255_255_255/0.8),0_8px_24px_-20px_rgb(40_34_24/0.35)] backdrop-blur-md supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 py-3">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 font-display text-lg leading-tight no-underline"
          >
            {/*
              The home's initial in a fine brass ring: the blind-stamped
              monogram at the head of a letter. The family portal's header
              carries the same mark, so a director sees their families' view
              in their own.
            */}
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-deep)]
                         text-[0.95rem] leading-none text-white
                         shadow-[inset_0_0_0_2px_var(--accent-deep),inset_0_0_0_3px_color-mix(in_oklab,var(--brass)_75%,white)]"
            >
              {monogram(session?.home.name ?? "")}
            </span>
            <span className="truncate">{session?.home.name ?? "Console"}</span>
          </Link>

          {/* A hairline between whose console this is and what is in it. */}
          <span className="hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden />

          <span className="ml-auto" />
          <SaveStatus />

          <nav aria-label="Sections" className="flex items-center gap-1">
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-9">
        <ConfirmAddressNotice />
        {children}
      </main>
    </div>
  );
}
