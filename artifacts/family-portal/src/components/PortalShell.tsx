import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetFamilySession,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { useLink } from "@/lib/link";
import { Loader2, Phone } from "lucide-react";

/**
 * The frame every screen sits in: the home's branding, the person who died,
 * and the way back.
 *
 * It also owns the three states that are not "a working portal", because
 * each of them needs a whole screen rather than an error toast: no link at
 * all, a link that has stopped working, and still loading.
 */

/** Paint the funeral home's colour over the theme's default. */
function useBrandColor(accent: string | undefined) {
  useEffect(() => {
    if (!accent) return;

    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    // A soft wash and a deeper shade, derived so a home only has to give one
    // colour. Mixed in oklab so a mid-tone brand colour does not produce a
    // muddy tint the way naive RGB blending does.
    root.style.setProperty("--accent-soft", `color-mix(in oklab, ${accent} 10%, white)`);
    root.style.setProperty("--accent-deep", `color-mix(in oklab, ${accent} 80%, black)`);
  }, [accent]);
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6 py-16">
      <div className="w-full max-w-md text-center">{children}</div>
    </div>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { token } = useLink();
  const [location] = useLocation();

  // Not fired at all until there is a link to fire it with: a visitor who
  // typed the bare domain should see the "you need your link" screen, not a
  // 401 on the way to it.
  const session = useGetFamilySession({
    query: {
      queryKey: getGetFamilySessionQueryKey(),
      enabled: token !== null,
    },
  });

  useBrandColor(session.data?.home.accentColor);

  if (token === null) {
    return (
      <FullScreen>
        <h1 className="font-display text-2xl mb-3">This page needs your link</h1>
        <p className="text-muted-foreground">
          Your funeral home sent you a link by text message. Open it from that
          message and this page will remember you.
        </p>
      </FullScreen>
    );
  }

  if (session.isPending) {
    return (
      <FullScreen>
        <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
      </FullScreen>
    );
  }

  if (session.isError) {
    const gone = (session.error as { status?: number } | null)?.status === 401;

    return (
      <FullScreen>
        <h1 className="font-display text-2xl mb-3">
          {gone ? "This link has expired" : "We couldn't open this"}
        </h1>
        <p className="text-muted-foreground">
          {gone
            ? "Please ask the funeral home to send you a new one. Nothing you have already added has been lost."
            : "Please check your connection and try again."}
        </p>
      </FullScreen>
    );
  }

  const { home, case: deceased } = session.data;
  const atHub = location === "/" || location.startsWith("/f/");

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-[var(--accent)] text-white">
        <div className="mx-auto w-full max-w-2xl px-5 py-4">
          <div className="flex items-center gap-3">
            {home.logoUploadId !== null && (
              <img
                src={`/api/family/uploads/${home.logoUploadId}`}
                alt=""
                className="h-9 w-9 rounded object-contain bg-white/95 p-1"
              />
            )}
            <div className="min-w-0">
              <p className="font-display text-base leading-tight truncate">
                {home.name}
              </p>
              <p className="text-white/75 text-sm leading-tight truncate">
                For {deceased.displayName}
              </p>
            </div>
          </div>
        </div>
      </header>

      {!atHub && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-4">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Everything else
          </Link>
        </div>
      )}

      <main className="mx-auto w-full max-w-2xl px-5 py-6 flex-1">{children}</main>

      {/*
        The urgent line, on every screen. A family who needs it needs it now,
        and should never have to work out which page it was on.
      */}
      {home.urgentPhone && (
        <footer className="mx-auto w-full max-w-2xl px-5 pb-8 pt-2">
          <a
            href={`tel:${home.urgentPhone.replace(/[^\d+]/g, "")}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
          >
            <Phone className="size-4" />
            If you need someone now, call {home.urgentPhone}
          </a>
        </footer>
      )}
    </div>
  );
}
