import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetFamilySession,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { useLink } from "@/lib/link";
import { PasteLink } from "@/components/PasteLink";
import { voiceFor } from "@/lib/voice";
import { ArrowLeft, Phone } from "lucide-react";
import { AuthedImage } from "@/components/AuthedImage";

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

    /*
     * The phone's own furniture, painted to match.
     *
     * This is opened on a phone, nearly always, and the branded header runs
     * right up under the status bar. Without this the strip above it stays
     * white and the page reads as a website that has been coloured in rather
     * than as something the funeral home handed over. It is a small detail
     * and it is most of the difference between the two.
     *
     * The header is a gradient from `--accent-deep` at the top down to
     * `--accent`, and it is the top that meets the status bar — so it is
     * that darker shade to match. Two things stop us simply reading the
     * token. A custom property is handed back verbatim by
     * `getComputedStyle`, so what comes out is the `color-mix()` expression
     * rather than a colour; and mixing in oklab, which is right for the page,
     * computes to an `oklab()` string that a `theme-color` meta tag cannot be
     * relied on to parse — least of all on the iOS Safari that most of these
     * families are holding.
     *
     * Asking the browser to compute the mix does not help either: Chrome
     * hands an sRGB mix back as `color(srgb 0.09 0.24 0.21)`, which is the
     * same problem in a different notation.
     *
     * So the browser is asked only for the one thing it answers in plain
     * `rgb(...)` — the home's own colour, normalised out of whatever
     * notation it was stored in — and the darkening is done here, where it
     * is three multiplications and cannot be serialised into a surprise.
     */
    const meta =
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]') ??
      document.head.appendChild(
        Object.assign(document.createElement("meta"), { name: "theme-color" }),
      );
    meta.content = darken(accent, 0.8) ?? accent;
  }, [accent]);
}

/**
 * A CSS colour, mixed `amount` of the way from black, as `rgb(r, g, b)`.
 *
 * Returns null if this browser could not make sense of the colour at all, in
 * which case the caller uses the home's colour undarkened — a shade light
 * rather than wrong.
 *
 * The browser does the parsing, because a funeral home's accent is stored as
 * free text and may arrive as a hex triple, a six-digit hex, `rgb()` or a
 * colour name, and re-implementing that here would be a parser to get wrong.
 * Computed `color` normalises all of them to `rgb(r, g, b)`.
 */
function darken(color: string, amount: number): string | null {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:${color}`;

  // The browser rejected the value outright, so there is nothing to read.
  if (!probe.style.color) return null;

  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const channels = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(computed);
  if (!channels) return null;

  const [r, g, b] = channels
    .slice(1, 4)
    .map((channel) => Math.round(Number(channel) * amount));

  return `rgb(${r}, ${g}, ${b})`;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-6 py-16">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * The loading state, which is nearly always over before it is seen.
 *
 * A spinner announces waiting; this does not. Three bars in the shape of the
 * heading and the two lines under it, breathing rather than spinning. If the
 * connection is slow enough that this is on screen for two seconds, the page
 * that replaces it does not jump.
 */
function Waiting() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10" role="status" aria-label="Loading">
      <div className="animate-pulse space-y-6">
        <div className="space-y-2.5">
          <div className="h-7 w-2/3 rounded-md bg-[var(--muted)]" />
          <div className="h-4 w-1/2 rounded-md bg-[var(--muted)]/70" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="h-16 rounded-xl bg-[var(--muted)]/60" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The way out for someone who is here by mistake: a funeral director who
 * opened the family portal's address instead of the console's. Only shown
 * when the deployment says where the console is.
 */
function StaffSignIn() {
  const configured = import.meta.env["VITE_CONSOLE_URL"] as string | undefined;
  const consoleUrl = configured?.trim().replace(/\/+$/, "");
  if (!consoleUrl) return null;

  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      Work at a funeral home?{" "}
      <a href={consoleUrl} className="font-medium text-foreground underline underline-offset-2">
        Staff sign in
      </a>
    </p>
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
    /*
     * Almost everyone who lands here has a link and has lost it somewhere in
     * their messages, so that is answered first and plainly.
     *
     * What used to be here was only that first paragraph, which made this a
     * dead end for the two people it did not describe: a family whose person
     * has just died and who found this page by searching, and someone
     * arranging their own funeral in advance. Neither of them has a link,
     * and neither of them should be told to go and find one.
     */
    return (
      <FullScreen>
        <div className="rounded-2xl border border-border bg-card p-7 shadow-[var(--elevation-2)] sm:p-9">
          <h1 className="font-display text-[1.6rem] mb-3">
            This page needs your link
          </h1>
          <p className="text-muted-foreground">
            Your funeral home sent you a link by text message or email. Open it
            from that message and this page will remember you — there is nothing
            to sign in to, and no password to remember.
          </p>

          <div className="mt-6">
            <PasteLink />
          </div>

          <hr className="my-7 border-0 border-t border-border" />

          <p className="eyebrow mb-3">If you have not been sent one</p>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Whether someone has died, or you are planning your own funeral in
              advance, start from the funeral home's own website — they will have
              a link on it — or telephone them. This page cannot reach them for
              you, because it does not know which home you mean.
            </p>
            <p className="text-sm text-muted-foreground">
              If you already have a file with them and cannot find the link,
              telephone and ask them to send another. Nothing you have added is
              lost.
            </p>
          </div>
        </div>
        <StaffSignIn />
      </FullScreen>
    );
  }

  if (session.isPending) {
    return <Waiting />;
  }

  if (session.isError) {
    const gone = (session.error as { status?: number } | null)?.status === 401;

    return (
      <FullScreen>
        <div className="rounded-2xl border border-border bg-card p-7 text-center shadow-[var(--elevation-2)] sm:p-9">
          <h1 className="font-display text-[1.6rem] mb-3">
            {gone ? "This link has expired" : "We couldn't open this"}
          </h1>
          <p className="text-muted-foreground">
            {gone
              ? "Please ask the funeral home to send you a new one. Nothing you have already added has been lost."
              : "Please check your connection and try again."}
          </p>
          {gone && (
            <div className="mt-6 text-left">
              <PasteLink />
            </div>
          )}
        </div>
      </FullScreen>
    );
  }

  const { home, case: subject } = session.data;
  const atHub = location === "/" || location.startsWith("/f/");
  // "For Eleanor Vance" is right for a bereavement and wrong for somebody
  // reading their own plan.
  const voice = voiceFor(subject.kind);

  return (
    <div className="min-h-dvh flex flex-col">
      {/*
        Sticky, and deliberately. The home's name at the top of the screen is
        the reassurance that this is the right place — a family who has to
        scroll up to check they are still somewhere their funeral home sent
        them has been let down by the design.

        The gradient is two stops of the home's own colour rather than a flat
        fill: flat blocks of saturated colour are what a form looks like, and
        a slight fall from deep to true is what a printed letterhead looks
        like.
      */}
      <header
        className="sticky top-0 z-30 text-white shadow-[0_1px_0_rgb(0_0_0/0.06),0_6px_16px_-12px_rgb(40_34_24/0.5)]"
        style={{
          background:
            "linear-gradient(170deg, var(--accent-deep) 0%, var(--accent) 65%)",
        }}
      >
        <div className="mx-auto w-full max-w-2xl px-5 py-4">
          <div className="flex items-center gap-3.5">
            {home.logoUploadId !== null && (
              <AuthedImage
                uploadId={home.logoUploadId}
                alt={home.name}
                className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-1.5 shadow-[0_1px_3px_rgb(0_0_0/0.18)] ring-1 ring-white/25"
              />
            )}
            <div className="min-w-0">
              <p className="font-display text-[1.0625rem] leading-tight truncate">
                {home.name}
              </p>
              <p className="truncate text-sm leading-tight text-white/70">
                {voice.strapline(subject.displayName)}
              </p>
            </div>
          </div>
        </div>
      </header>

      {!atHub && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-5">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
          >
            <ArrowLeft className="size-4 transition-transform duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)] group-hover:-translate-x-0.5" />
            Everything else
          </Link>
        </div>
      )}

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-10 pt-6">
        {children}
      </main>

      {/*
        The urgent line, on every screen. A family who needs it needs it now,
        and should never have to work out which page it was on.

        Set below a hairline rule and in the home's own colour, so it reads as
        the last line of the stationery rather than as another button.
      */}
      {home.urgentPhone && (
        <footer className="mx-auto w-full max-w-2xl px-5 pb-10">
          <hr className="mb-5 border-0 border-t border-border" />
          <a
            href={`tel:${home.urgentPhone.replace(/[^\d+]/g, "")}`}
            className="lift flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5
                       no-underline shadow-[var(--elevation-1)] transition-gentle
                       hover:border-[var(--accent)]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
              <Phone className="size-4" strokeWidth={1.75} />
            </span>
            {/*
              Two lines, not one. Centred on a single line this wrapped at
              phone width into "call" on one row and half a telephone number
              on the next — which is the one piece of text on this product
              that has to be readable at a glance in the dark.
            */}
            <span className="min-w-0">
              <span className="block text-sm text-muted-foreground">
                If you need someone now
              </span>
              <span className="tabular block font-semibold text-foreground">
                {home.urgentPhone}
              </span>
            </span>
          </a>
        </footer>
      )}
    </div>
  );
}
