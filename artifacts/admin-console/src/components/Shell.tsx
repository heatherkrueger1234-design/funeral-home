import type { ReactNode } from "react";
import { Link, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { api, cn } from "@/lib/api";
import { Button } from "./ui";

/**
 * The frame. Five places to be, because there are five things this console
 * does, and a list of five does not need a sidebar that collapses.
 */

const PLACES = [
  { href: "/", label: "Overview" },
  { href: "/homes", label: "Homes" },
  { href: "/groups", label: "Groups" },
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
  // Settled rather than succeeded: a logout that fails on the network still
  // leaves the person wanting to be signed out, and the button used to do
  // nothing at all when it did.
  const signOut = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: onSignedOut,
  });

  return (
    <div className="min-h-dvh">
      {/* Sticky: this console is read alongside a long table, and whose
          platform it is should not scroll away. Not on a phone, where the
          wrapped navigation would take a quarter of the screen with it. */}
      <header className="z-30 sm:sticky sm:top-0 border-b border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-sm supports-[backdrop-filter]:bg-[var(--card)]/85">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/" className="font-display text-lg no-underline">
            Continuum Aftercare
          </Link>

          <span
            className="hidden h-5 w-px shrink-0 bg-[var(--border)] sm:block"
            aria-hidden
          />
          <nav
            aria-label="Sections"
            className="order-last -mx-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:mx-0 sm:w-auto"
          >
            {PLACES.map((place) => (
              <NavLink key={place.href} {...place} />
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
            {/* Not on a phone, where it would cost the header a row; above
                that, a long address truncates rather than pushing "Sign out"
                off the edge. */}
            <span
              className="hidden min-w-0 truncate text-[var(--muted-foreground)] sm:inline"
              title={signedInAs}
            >
              {signedInAs}
            </span>
            <Button
              variant="plain"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>

    </div>
  );
}
