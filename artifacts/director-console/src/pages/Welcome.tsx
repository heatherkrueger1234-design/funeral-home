import { useEffect, useState, type ReactNode } from "react";
import {
  PRICE_BOOK,
  dollars,
  locationAnnualCents,
  monthlyBillCents,
} from "../../../../lib/db/src/price-book";
import { BASE_PATH } from "@/lib/base";
import { Button } from "@/components/ui/button";
import { Check, Pause, Play } from "lucide-react";

/**
 * The funeral home side's front page: what this is, what is in it, what it
 * costs, and a short walkthrough of it working.
 *
 * It is not linked from anywhere a family can see. It is reached by the
 * hidden doors on the family portal's "needs your link" screen, or by its
 * address, and it opens with the sign-in and the free trial one tap away.
 * Nothing on it is private -- the price is the price on the public site --
 * so the door is for who it is for, not a lock.
 *
 * The walkthrough is drawn, not recorded: sample names, the same screens, in
 * the order a home meets them. It plays itself, stops for anybody who has
 * asked their device for less motion, and can be stepped through by hand.
 */

const signInHref = `${BASE_PATH}/`.replace(/\/{2,}/g, "/");
const trialHref = `${signInHref}?register`;

/* ------------------------------------------------------ the walkthrough -- */

type Scene = {
  side: "Funeral home" | "The family" | "A year later";
  title: string;
  caption: string;
  mock: ReactNode;
};

function Bubble({ from, children }: { from: "them" | "us"; children: ReactNode }) {
  return (
    <div
      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
        from === "us"
          ? "ml-auto rounded-br-md bg-[var(--accent-deep)] text-white"
          : "rounded-bl-md bg-muted text-foreground"
      }`}
    >
      {children}
    </div>
  );
}

function Row({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-2.5 last:border-0">
      <span className="text-sm">{label}</span>
      <span
        className={`flex items-center gap-1.5 text-sm ${done ? "text-[var(--accent-deep)]" : "text-muted-foreground"}`}
      >
        {done && <Check className="size-4" aria-hidden />}
        {value}
      </span>
    </div>
  );
}

const SCENES: Scene[] = [
  {
    side: "Funeral home",
    title: "Add the family, send one link",
    caption:
      "At the arrangement conference you add the next of kin and their mobile number. One tap texts them their private page, in your home's name.",
    mock: (
      <div className="space-y-3">
        <p className="eyebrow">Add a family contact</p>
        <div className="rounded-xl border border-border p-3 text-sm">
          <p className="font-medium">Anne Hale</p>
          <p className="text-muted-foreground">Daughter · (303) 555-0142</p>
        </div>
        <div className="rounded-lg bg-[var(--accent-deep)] px-4 py-2.5 text-center text-sm font-medium text-white">
          Text her the link
        </div>
        <Bubble from="us">
          Willowbank Funeral Home: here is your private page for the
          arrangements. No password needed.
        </Bubble>
      </div>
    ),
  },
  {
    side: "The family",
    title: "They tap it, and they are in",
    caption:
      "No account and no app. The link opens a page with your home's name and colour, and a short list of what would help.",
    mock: (
      <div className="space-y-1">
        <p className="font-display text-lg">Willowbank Funeral Home</p>
        <p className="mb-3 text-sm text-muted-foreground">For Margaret Hale</p>
        <Row label="Photographs" value="Add some" />
        <Row label="Obituary" value="Start writing" />
        <Row label="Music and readings" value="Choose" />
        <Row label="Service time" value="Thursday, 11:00" done />
      </div>
    ),
  },
  {
    side: "The family",
    title: "This is what a family sees when they add things",
    caption:
      "Photographs go in from the phone's own gallery. The obituary can be typed, or built from a few questions. Everything saves as they go.",
    mock: (
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
            <div
              key={n}
              className="aspect-square rounded-lg bg-gradient-to-br from-[var(--accent-soft)] to-muted"
              style={{ opacity: n < 6 ? 1 : 0.45 }}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">6 photographs added</p>
        <div className="rounded-xl border border-border p-3 text-sm leading-relaxed">
          Margaret grew up on the Western Slope, taught third grade for thirty-one
          years, and kept the best garden on Aspen Street…
        </div>
      </div>
    ),
  },
  {
    side: "Funeral home",
    title: "You see it arrive",
    caption:
      "The case shows what has come in and what is still open, so the arrangement conference is not the first time you see any of it.",
    mock: (
      <div className="space-y-1">
        <p className="font-display text-lg">Margaret Hale</p>
        <p className="mb-3 text-sm text-muted-foreground">Service Thursday · Anne Hale opened her link</p>
        <Row label="Photographs" value="6 added" done />
        <Row label="Obituary" value="Draft to review" done />
        <Row label="Death certificate" value="72 hours left" />
        <Row label="Messages" value="1 unread" />
      </div>
    ),
  },
  {
    side: "A year later",
    title: "Thinking of you, from the home",
    caption:
      "If the family agrees, your home's own note goes out on the anniversary, and at the other points in the first year you choose. In your name, by email or text.",
    mock: (
      <div className="space-y-3">
        <p className="eyebrow">From Willowbank Funeral Home · one year</p>
        <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed">
          <p>Dear Anne,</p>
          <p className="mt-2">
            Tomorrow is one year since your mother died. We have been thinking
            of you, and of her. There is nothing you need to do. If it would
            help to talk, we are here.
          </p>
          <p className="mt-2 text-muted-foreground">— Everyone at Willowbank</p>
        </div>
      </div>
    ),
  },
];

const SCENE_MS = 6500;

function Walkthrough() {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reduced);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % SCENES.length), SCENE_MS);
    return () => clearTimeout(timer);
  }, [playing, index]);

  const scene = SCENES[index]!;

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_22rem]">
      <div>
        <p className="eyebrow">{scene.side}</p>
        <h3 className="mt-2 font-display text-2xl sm:text-3xl">{scene.title}</h3>
        <p className="mt-3 max-w-prose text-muted-foreground">{scene.caption}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <ol className="flex gap-2" aria-label="Scenes">
            {SCENES.map((s, n) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => {
                    setIndex(n);
                    setPlaying(false);
                  }}
                  aria-label={`Scene ${n + 1}: ${s.title}`}
                  aria-current={n === index}
                  className={`h-2.5 rounded-full transition-all ${
                    n === index ? "w-8 bg-[var(--accent-deep)]" : "w-2.5 bg-border"
                  }`}
                />
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          A drawn walkthrough with sample names, not a recording of a real family.
        </p>
      </div>

      {/* The phone. Keyed on the scene so each one fades in rather than swapping. */}
      <div className="mx-auto w-full max-w-[22rem]">
        <div className="rounded-[2rem] border border-border bg-card p-3 shadow-[var(--elevation-2,0_10px_30px_-12px_rgb(0_0_0/0.25))]">
          <div className="min-h-[24rem] rounded-[1.5rem] bg-background p-5">
            <div key={index} className="animate-in fade-in duration-500">
              {scene.mock}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the page -- */

function Mark({ className }: { className?: string }) {
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

const WHAT_WE_DO = [
  {
    title: "One link for each family",
    body: "A text message, no password and no app. Photographs, the obituary, music and the service details all land in one place, on your home's own page.",
  },
  {
    title: "The work behind the arrangement",
    body: "Deadlines for the paperwork that holds everything up, a thread with the family, print-ready programs, and a case you can export whole.",
  },
  {
    title: "Care after the service",
    body: "Grief check-ins by email and text, in your name, through the first year: including a note on the anniversary. Families can stop them at any time.",
  },
];

export default function Welcome() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border/80">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Mark className="size-9 shrink-0" />
          <span className="whitespace-nowrap font-display text-lg sm:text-xl">Continuum Aftercare</span>
          <div className="ml-auto flex items-center gap-3">
            <a href={signInHref} className="text-[0.95rem] font-semibold no-underline">
              Sign in
            </a>
            <Button asChild size="sm" className="max-sm:hidden">
              <a href={trialHref}>Start a free trial</a>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">For funeral homes</p>
            <h1 className="mt-4 text-4xl sm:text-5xl">
              One link for each family. Everything they send, in one place.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Families add photographs, write the obituary and choose the music from
              their own phone. You see it as it arrives, and your home stays in touch
              for the year after.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <a href={trialHref}>Start a {PRICE_BOOK.trialDays}-day free trial</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#see-it">See it working</a>
              </Button>
            </div>
          </div>
        </section>

        <section id="see-it" className="border-y border-border bg-card/50 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <p className="eyebrow">See it working</p>
            <h2 className="mb-10 mt-2 text-3xl sm:text-4xl">
              From the first call to a year on
            </h2>
            <Walkthrough />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="eyebrow">What we do</p>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {WHAT_WE_DO.map((item) => (
              <div key={item.title} className="rounded-2xl border border-border bg-card p-6">
                <h3 className="font-display text-xl">{item.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-card/50 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="eyebrow">What is included</p>
              <h2 className="mt-2 text-3xl">Everything, in the one price</h2>
              <ul className="mt-6 space-y-3">
                {PRICE_BOOK.included.map((line) => (
                  <li key={line} className="flex gap-3">
                    <Check className="mt-1 size-4 shrink-0 text-[var(--accent-deep)]" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
                <li className="flex gap-3">
                  <Check className="mt-1 size-4 shrink-0 text-[var(--accent-deep)]" aria-hidden />
                  <span>Families are never charged, for anything</span>
                </li>
              </ul>
            </div>

            <div>
              <p className="eyebrow">Pricing</p>
              <h2 className="mt-2 text-3xl">
                {dollars(PRICE_BOOK.locationMonthlyCents)} a month per location
              </h2>
              <p className="mt-3 text-muted-foreground">
                Plus {dollars(PRICE_BOOK.perFuneralCents)} for each funeral you serve.
                No setup fee, and {PRICE_BOOK.trialDays} days free with no card.
              </p>
              <dl className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
                <div className="flex justify-between gap-4 px-5 py-3.5">
                  <dt>A home with ten funerals a month</dt>
                  <dd className="tabular font-semibold">{dollars(monthlyBillCents(10))} a month</dd>
                </div>
                <div className="flex justify-between gap-4 px-5 py-3.5">
                  <dt>A rural home with two</dt>
                  <dd className="tabular font-semibold">{dollars(monthlyBillCents(2))} a month</dd>
                </div>
                <div className="flex justify-between gap-4 px-5 py-3.5">
                  <dt>Pay yearly: twelve months for ten</dt>
                  <dd className="tabular font-semibold">{dollars(locationAnnualCents)} a year</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-20">
          <h2 className="text-3xl sm:text-4xl">Try it with one family</h2>
          <p className="mt-3 text-muted-foreground">
            Set up in an afternoon. If it is not for you, export everything and go.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <a href={trialHref}>Start a free trial</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={signInHref}>Sign in</a>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
