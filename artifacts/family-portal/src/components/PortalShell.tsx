import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useMutationState, useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilySession,
  getGetFamilySessionQueryKey,
  getGetFamilyDeadlinesQueryKey,
  getGetFamilyServiceOffersQueryKey,
} from "@workspace/api-client-react";
import { isUnauthorized, refusedForTheLink, stoppedLinkWords, useLink } from "@/lib/link";
import { PasteLink } from "@/components/PasteLink";
import { SignInByCode } from "@/components/SignInByCode";
import { voiceFor } from "@/lib/voice";
import { ArrowLeft, Phone } from "lucide-react";
import { AuthedImage } from "@/components/AuthedImage";
import { useBrandColor } from "@/lib/brand-color";
import { doorAddress, knock, markTappedTwice, type Knock } from "@/lib/knock";

/**
 * The frame every screen sits in: the home's branding, the person who died,
 * and the way back.
 *
 * It also owns the three states that are not "a working portal", because
 * each of them needs a whole screen rather than an error toast: no link at
 * all, a link that has stopped working, and still loading.
 */

/**
 * When either date on the case changes, the timeline built from it has moved
 * on the server too, so the family's copy of it is refetched rather than left
 * showing the old dates until the next reload.
 */
function useFollowDateChanges(
  row: { serviceAt: string | null; dateOfDeath: string | null } | undefined,
) {
  const queryClient = useQueryClient();
  const key = row ? `${row.serviceAt ?? ""}|${row.dateOfDeath ?? ""}` : null;
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (key === null) return;
    if (previous.current !== null && previous.current !== key) {
      void queryClient.invalidateQueries({
        queryKey: getGetFamilyDeadlinesQueryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: getGetFamilyServiceOffersQueryKey(),
      });
    }
    previous.current = key;
  }, [key, queryClient]);
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

/**
 * The product's mark: cupped hands holding a light, in its own green and
 * paper. Drawn here, as on the marketing site, so the screen that has no home
 * to borrow a logo from still has one.
 */
function ContinuumMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 180" className={className} role="img" aria-label="Continuum Aftercare">
      <rect width="180" height="180" rx="40" fill="#1f4e46" />
      <circle cx="90" cy="76" r="20" fill="#f8f6f1" />
      <path
        d="M40 102c0 29 22 46 50 46s50-17 50-46"
        stroke="#f8f6f1"
        strokeWidth="11"
        strokeLinecap="round"
        fill="none"
        opacity="0.92"
      />
    </svg>
  );
}

/**
 * The hidden doors (`lib/knock.ts`), and the code sign-in for a family that
 * has lost its link.
 *
 * Two taps on the mark and then nothing for a moment opens the family's own
 * code form, because a third tap would have been the funeral home door. That
 * short wait is the price of keeping all of them off the screen.
 */
function useKnocks() {
  const history = useRef<ReturnType<typeof knock>["history"]>([]);
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [familyDoor, setFamilyDoor] = useState(false);

  useEffect(() => () => clearTimeout(wait.current), []);

  const tap = useCallback((which: Knock) => {
    clearTimeout(wait.current);
    const result = knock(history.current, which, Date.now());
    history.current = result.history;

    if (result.door) {
      const address = doorAddress(result.door);
      if (address) window.location.assign(address);
      return;
    }
    if (which === "mark" && markTappedTwice(result.history)) {
      wait.current = setTimeout(() => setFamilyDoor((open) => !open), 700);
    }
  }, []);

  return { tap, familyDoor };
}

/** The mark and the name, which are the first knock. */
function Brand({ onTap, centered = false }: { onTap: () => void; centered?: boolean }) {
  return (
    <div
      onClick={onTap}
      className={`mb-7 flex w-fit select-none items-center gap-3 ${centered ? "mx-auto" : ""}`}
    >
      <ContinuumMark className="size-11 shrink-0" />
      <span className="font-display text-xl leading-tight">Continuum Aftercare</span>
    </div>
  );
}

/**
 * A word that is part of the sentence and nothing else, to anybody who is
 * not knocking: no colour, no underline, no pointer, not reachable by Tab.
 */
function Word({ children, onTap }: { children: string; onTap: () => void }) {
  return (
    <span onClick={onTap} className="cursor-text">
      {children}
    </span>
  );
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
      /*
       * The one query that polls. When the home moves the funeral or fills
       * in a date, the family has to see it without being told to reload --
       * the whole point is that both sides are looking at the same facts.
       * Every other screen stays on the app's no-refetch default to spare a
       * phone on mobile data; this is one small request every two minutes,
       * and only while the tab is open.
       */
      refetchInterval: 120_000,
      refetchOnWindowFocus: true,
    },
  });

  useBrandColor(session.data?.home.accentColor);
  useFollowDateChanges(session.data?.case);
  // Whether the expired-link screen, should it be drawn, is there because a
  // save was just refused -- whose change is then the one thing not kept.
  const refusedSave = useMutationState({ filters: refusedForTheLink }).length > 0;
  const { tap, familyDoor } = useKnocks();

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
        <div className="engraved rounded-2xl border border-[var(--brass-soft)] bg-card p-7 sm:p-9">
          <Brand onTap={() => tap("mark")} />
          <h1 className="font-display text-[1.6rem] mb-3">
            This <Word onTap={() => tap("page")}>page</Word> needs your link
          </h1>
          <p className="text-muted-foreground">
            Your <Word onTap={() => tap("funeral")}>funeral</Word> home sent you a
            link by text message or email. Open it from that message and this
            page will remember you — there is nothing to sign in to, and no
            password to remember.
          </p>

          {familyDoor && (
            <div className="mt-6">
              <SignInByCode />
            </div>
          )}

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
              telephone and ask them to send another.
              Nothing you have added is lost.
            </p>
          </div>
        </div>
      </FullScreen>
    );
  }

  if (session.isPending) {
    return <Waiting />;
  }

  const gone = session.isError && isUnauthorized(session.error);

  /*
   * A failed *refresh* is not a failed page. The session is polled every two
   * minutes, and one dropped request on hospital wifi used to swap whatever
   * the family had open -- an obituary half-typed -- for "We couldn't open
   * this". With the session already in hand, only a link that has actually
   * stopped working replaces the screen; anything else waits for the next
   * poll.
   */
  if (session.isError && (gone || !session.data)) {

    return (
      <FullScreen>
        <div className="engraved rounded-2xl border border-[var(--brass-soft)] bg-card p-7 text-center sm:p-9">
          {gone ? (
            <Brand centered onTap={() => tap("mark")} />
          ) : (
            <div className="ornament mx-auto mb-6 max-w-[7rem]" aria-hidden>
              <i />
            </div>
          )}
          <h1 className="font-display text-[1.6rem] mb-3">
            {gone ? "This link has expired" : "We couldn't open this"}
          </h1>
          <p className="text-muted-foreground">
            {gone ? stoppedLinkWords(refusedSave) : "Please check your connection and try again."}
          </p>
          {gone ? (
            <div className="mt-6 space-y-6 text-left">
              {familyDoor && <SignInByCode />}
              <PasteLink />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="mt-6"
              disabled={session.isFetching}
              onClick={() => void session.refetch()}
            >
              Try again
            </Button>
          )}
        </div>
      </FullScreen>
    );
  }

  if (!session.data) return <Waiting />;

  const { home, case: subject, contact } = session.data;
  const atHub = location === "/" || location.startsWith("/f/");
  // "For Eleanor Vance" is right for a bereavement and wrong for a plan,
  // whoever is reading it.
  const voice = voiceFor(subject.kind, contact.isSubject);

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
            {home.logoUploadId !== null ? (
              <AuthedImage
                uploadId={home.logoUploadId}
                // A logo is not a photograph; it is drawn as the home made it.
                size="full"
                alt={home.name}
                className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-1.5 shadow-[0_1px_3px_rgb(0_0_0/0.18)] ring-1 ring-white/25"
              />
            ) : (
              /*
                No logo yet: the home's initial, cut in the serif inside a
                fine ring, the way a monogram is blind-stamped on a letterhead.
                Without it the name sits alone against the colour and the
                header reads as a title bar rather than as the home's own.
              */
              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-full font-display text-lg
                           leading-none text-white/95 ring-1 ring-inset ring-white/35
                           shadow-[inset_0_0_0_3px_rgb(255_255_255/0.06)]"
              >
                {monogram(home.name)}
              </span>
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
        {/* The gilt edge along the foot of the letterhead. */}
        <span
          aria-hidden
          className="block h-px bg-[linear-gradient(to_right,transparent,color-mix(in_oklab,var(--brass)_70%,white)_20%,color-mix(in_oklab,var(--brass)_70%,white)_80%,transparent)] opacity-60"
        />
      </header>

      {!atHub && (
        <div className="mx-auto w-full max-w-2xl px-5 pt-5">
          <Link
            href="/"
            className="group -my-2 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-muted-foreground no-underline transition-colors duration-200 hover:text-foreground"
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
      <footer className="mx-auto w-full max-w-2xl px-5 pb-12">
        {home.urgentPhone && (
          <>
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
          </>
        )}

        {/*
          The colophon: the home's name, small and centred under a printer's
          ornament, as the last line of every screen. It is the signature on
          the stationery — the thing that says who sent this.
        */}
        <div className="mt-10 text-center">
          <div className="ornament mx-auto max-w-[8rem]" aria-hidden>
            <i />
          </div>
          <p className="mt-3 font-display text-sm text-muted-foreground">
            {home.name}
          </p>
        </div>
      </footer>
    </div>
  );
}
