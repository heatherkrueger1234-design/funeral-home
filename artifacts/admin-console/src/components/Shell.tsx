import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { api, cn, isUnauthorized } from "@/lib/api";
import { Button } from "./ui";

/**
 * Move focus to the new page's heading when the page changes.
 *
 * A client-side route change swaps the content and leaves focus on the link
 * that was clicked, up in the navigation, so somebody using a screen reader
 * or a keyboard hears nothing and has to find their way back down the page.
 * Focusing the `h1` is what a full page load would have given them.
 *
 * Most pages draw their heading only once their data arrives, so this waits
 * for one to appear -- briefly; a page that never draws one is left alone.
 * Not on first load: the browser already puts focus at the top of the
 * document then, and stealing it would be rude.
 */
function useFocusHeadingOnNavigate(mainRef: RefObject<HTMLElement | null>) {
  const [location] = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    const main = mainRef.current;
    if (!main) return;

    const focusHeading = (): boolean => {
      const heading = main.querySelector("h1");
      if (!heading) return false;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: false });
      return true;
    };

    if (focusHeading()) return;

    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => observer.disconnect(), 5000);

    return () => {
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [location, mainRef]);
}

/**
 * The frame. Four places to be, because there are four things this console
 * does, and a list of four does not need a sidebar that collapses.
 */

const PLACES = [
  { href: "/", label: "Overview" },
  { href: "/homes", label: "Homes" },
  { href: "/audit", label: "Access log" },
  { href: "/admins", label: "Who has access" },
] as const;

function NavLink({ href, label }: { href: string; label: string }) {
  // `useRoute` rather than comparing strings, so "/homes/4" still lights up
  // "Homes" and the root does not light up everything.
  const [exact] = useRoute(href);
  const [nested] = useRoute(`${href}/*`);
  const active = href === "/" ? exact : exact || nested;

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-semibold no-underline",
        "transition-colors duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-deep)]"
          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
      )}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

export function Shell({
  children,
  signedInAs,
  onSignedOut,
}: {
  children: ReactNode;
  signedInAs: string;
  onSignedOut: () => void;
}) {
  const signOut = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: onSignedOut,
    /*
     * A 401 means the session was already gone -- which is what signing out
     * was for -- so that goes to the front door too. Anything else is said
     * out loud: a button that silently did nothing leaves somebody on a
     * shared laptop believing they have signed out when they have not.
     */
    onError: (error) => {
      if (isUnauthorized(error)) onSignedOut();
    },
  });

  const mainRef = useRef<HTMLElement>(null);
  useFocusHeadingOnNavigate(mainRef);

  return (
    <div className="min-h-dvh">
      {/* Sticky: this console is read alongside a long table, and whose
          platform it is should not scroll away. */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-sm supports-[backdrop-filter]:bg-[var(--card)]/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5">
          <Link href="/" className="font-display text-lg no-underline">
            Continuum Aftercare
          </Link>

          <span
            className="hidden h-5 w-px shrink-0 bg-[var(--border)] sm:block"
            aria-hidden
          />
          <nav aria-label="Sections" className="flex flex-wrap items-center gap-1">
            {PLACES.map((place) => (
              <NavLink key={place.href} {...place} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-[var(--muted-foreground)]">{signedInAs}</span>
            <Button
              variant="plain"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </Button>
          </div>
          {signOut.error && !isUnauthorized(signOut.error) && (
            <p role="alert" className="w-full text-right text-sm text-[var(--notice)]">
              That didn't sign you out -- you are still signed in. Please try
              again, or close the browser if this is a shared computer.
            </p>
          )}
        </div>
      </header>

      <main ref={mainRef} className="mx-auto max-w-6xl px-6 py-8">
        {children}
      </main>

    </div>
  );
}
