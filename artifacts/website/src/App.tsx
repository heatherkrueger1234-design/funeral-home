import type { ReactNode } from "react";
import {
  Desk,
  Icon,
  Phone,
  Section,
  buttonPrimary,
  buttonSecondary,
} from "./components";
import { screens } from "./screens";
import {
  contactEmail,
  contactHref,
  privacyHref,
  signInHref,
  termsHref,
  trialHref,
} from "./config";

/*
 * The page, top to bottom.
 *
 * Two rules the copy is held to, and a reviewer should hold it to them too:
 *
 * 1. It is written to funeral home owners and directors, and to nobody else.
 *    "Your families", "your staff". There is no section addressed to a
 *    bereaved person and no button a family could mistake for theirs; the
 *    family portal never links here, and nothing here should invite a family
 *    in.
 *
 * 2. Every claim is one the code backs today. The sources are replit.md,
 *    PRICING.md, RETENTION.md and LEGAL/README.md, which cites the file
 *    behind each security claim. No customer counts, no testimonials, no
 *    logos, no uptime figure, no certification, no price. Where something is
 *    a draft (the legal documents) the page says so. If the product changes
 *    underneath a sentence here, change the sentence.
 */

const nav = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#what-it-is-not", label: "What it isn't" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

function Wordmark() {
  return (
    <a href="#top" className="whitespace-nowrap font-display text-xl text-foreground no-underline">
      Holding Today
    </a>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <nav aria-label="Sections" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-7 text-[0.95rem]">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="text-muted-foreground no-underline hover:text-foreground">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          {signInHref && (
            <a
              href={signInHref}
              className="text-[0.95rem] font-semibold text-foreground no-underline hover:text-accent"
            >
              Sign in
            </a>
          )}
          <a href={trialHref} className={`${buttonPrimary} !px-4 !py-2 !text-[0.95rem] max-sm:!hidden`}>
            Start a free trial
          </a>
        </div>
      </div>
      {/*
        Below the desktop width the section links become a second row that
        scrolls sideways, rather than a menu that opens: a menu needs a script
        to close itself after a link is chosen, and this page has none.
      */}
      <nav aria-label="Sections" className="border-t border-border/60 lg:hidden">
        <ul className="mx-auto flex w-full max-w-6xl gap-4 overflow-x-auto whitespace-nowrap px-4 py-2.5 text-[0.9rem] sm:gap-6 [scrollbar-width:none] sm:px-6">
          {nav.map((item) => (
            <li key={item.href} className="shrink-0">
              <a href={item.href} className="text-muted-foreground no-underline hover:text-foreground">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <div className="wash overflow-hidden">
      <Section labelledBy="hero-title" className="pb-16 pt-14 sm:pt-20 lg:pb-24">
        <div className="mx-auto max-w-3xl sm:text-center">
          <p className="eyebrow">Family portal software for funeral homes</p>
          <h1 id="hero-title" className="mt-4 text-[2.35rem] sm:text-5xl lg:text-[3.6rem]">
            One link for each family. Everything they send, in one place.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Holding Today gives every family you serve a single link, texted to their phone, for the
            photographs, the obituary, the hymns and their questions. Your staff get one page for every
            case. It works beside the case-management system you already have, not instead of it.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
            <a href={trialHref} className={buttonPrimary}>
              Start a free trial
              <Icon name="arrow" className="size-4" />
            </a>
            <a href="#how-it-works" className={buttonSecondary}>
              See how it works
            </a>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            30 days free, with every feature. No card needed to start.
          </p>
        </div>

        <figure className="relative mx-auto mt-14 max-w-5xl sm:mt-16">
          <div className="lg:mr-28">
            <Desk screen={screens.consoleToday} eager sizes="(min-width: 1152px) 880px, (min-width: 1024px) 78vw, 94vw" />
          </div>
          <div className="mx-auto mt-10 w-[68%] max-w-[270px] sm:w-[42%] lg:absolute lg:-bottom-12 lg:right-0 lg:mt-0 lg:w-[240px]">
            <Phone screen={screens.familyHub} eager sizes="(min-width: 1024px) 240px, 270px" />
          </div>
          <figcaption className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground lg:mt-8 lg:max-w-[calc(100%-18rem)]">
            <strong className="font-semibold text-foreground">Your families see your name, not ours.</strong>{" "}
            The portal carries your home's name, mark and colour. Holding Today appears nowhere on it.
            <span className="mt-1 block">
              Real screens from the product. Juniper Ridge and everyone in it are invented.
            </span>
          </figcaption>
        </figure>
      </Section>
    </div>
  );
}

const inbox = [
  ["Ruth Ellison-Park", "Fwd: Fwd: Mum pics (part 3 of 5)", "11:52 PM", "7 attachments"],
  ["Daniel", "photos from the farm", "11:40 PM", "12 attachments"],
  ["June (Mum's sister)", "Re: which hymns??", "11:17 PM", ""],
  ["Michael Park", "the obituary, Ruth's version", "10:58 PM", "1 attachment"],
  ["Ruth Ellison-Park", "IMG_4471.HEIC", "10:31 PM", "1 attachment"],
  ["Sam Ellison", "Re: Re: who is carrying?", "9:46 PM", ""],
];

function Problem() {
  return (
    <Section labelledBy="problem-title" className="border-y border-border bg-card py-20 sm:py-24">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <p className="eyebrow">The problem</p>
          <h2 id="problem-title" className="mt-3 text-3xl sm:text-4xl">
            It is midnight, and there are forty attachments from six addresses.
          </h2>
          <div className="mt-6 space-y-4 text-lg leading-relaxed text-muted-foreground">
            <p>
              Photographs arrive by email and by text, from a daughter, a son, a sister and a
              grandson, some of them twice. The obituary comes in three versions. One sibling asks
              about the hymns and another was told something different, and you answer the same
              question four times.
            </p>
            <p>
              Meanwhile the family has not been told what is due or when, because nobody built the
              timeline, because there were four funerals this week.
            </p>
            <p className="text-foreground">
              None of this is what your case-management system is for. It is the collaboration with
              the family, and it is the part nobody had built.
            </p>
          </div>
        </div>

        <figure aria-labelledby="inbox-caption">
          <div className="rounded-xl border border-border-strong bg-sunken shadow-raised" aria-hidden="true">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="text-sm font-semibold">Inbox</span>
              <span className="rounded-full bg-notice-soft px-2.5 py-0.5 text-xs font-semibold text-notice">
                38 unread
              </span>
            </div>
            <ul className="divide-y divide-border">
              {inbox.map(([from, subject, time, files]) => (
                <li key={subject} className="grid grid-cols-[1fr_auto] gap-x-4 px-5 py-3">
                  <span className="truncate text-[0.95rem] font-semibold">{from}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{time}</span>
                  <span className="truncate text-[0.95rem] text-muted-foreground">{subject}</span>
                  <span className="text-sm text-muted-foreground">{files}</span>
                </li>
              ))}
            </ul>
          </div>
          <figcaption id="inbox-caption" className="mt-3 text-sm text-muted-foreground">
            An illustration of the inbox this replaces, not a screen from the product.
          </figcaption>
        </figure>
      </div>
    </Section>
  );
}

function Feature(props: {
  number: string;
  id: string;
  title: string;
  lede: string;
  points: ReactNode[];
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <article
      aria-labelledby={props.id}
      className="grid items-center gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:gap-16"
    >
      <div className={props.flip ? "lg:order-2" : undefined}>
        <p className="font-display text-sm text-accent">{props.number}</p>
        <h3 id={props.id} className="mt-2 text-[1.75rem] sm:text-3xl">
          {props.title}
        </h3>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{props.lede}</p>
        <ul className="mt-6 space-y-3">
          {props.points.map((point, index) => (
            <li key={index} className="flex gap-3 leading-relaxed">
              <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon name="check" className="size-3.5" />
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={props.flip ? "lg:order-1" : undefined}>{props.visual}</div>
    </article>
  );
}

/** A desktop screen with a phone overlapping its corner. */
function Pair(props: { desk: ReactNode; phone: ReactNode; caption: string }) {
  return (
    <figure>
      <Panel>
        {/*
          On a phone the desktop screen would be too small to read, so only the
          family's side is shown there, at a size that can be.
        */}
        <div className="relative sm:pb-24">
          <div className="hidden pr-24 sm:block">{props.desk}</div>
          <div className="mx-auto max-w-[260px] sm:absolute sm:bottom-0 sm:right-0 sm:w-[40%] sm:max-w-[200px]">
            {props.phone}
          </div>
        </div>
      </Panel>
      <figcaption className="mt-4 text-sm text-muted-foreground">{props.caption}</figcaption>
    </figure>
  );
}

function PhoneFigure(props: { phone: ReactNode; caption: string }) {
  return (
    <figure>
      <Panel>
        <div className="mx-auto max-w-[280px]">{props.phone}</div>
      </Panel>
      <figcaption className="mt-4 text-sm text-muted-foreground">{props.caption}</figcaption>
    </figure>
  );
}

/** The quiet tinted ground every product screen sits on. */
function Panel(props: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-[linear-gradient(160deg,#eef3f1,#efebe3)] p-5 sm:p-9">
      {props.children}
    </div>
  );
}

function Features() {
  const deskSizes = "(min-width: 1152px) 470px, (min-width: 1024px) 40vw, 80vw";
  const phoneSizes = "(min-width: 640px) 210px, 38vw";
  const soloPhone = "300px";

  return (
    <Section id="how-it-works" labelledBy="features-title" className="py-20 sm:py-24">
      <div className="max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 id="features-title" className="mt-3 text-3xl sm:text-4xl">
          Five things, done properly.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Each family gets a link. There is no app to install, no account to make and no password to
          forget, three days after a death. Your staff work from the console.
        </p>
      </div>

      <div className="mt-6 divide-y divide-border">
        <Feature
          number="One"
          id="f-asset-drop"
          title="The asset drop"
          lede="One mobile link, texted to the next of kin, replaces the inbox. Everyone on the family's side adds to the same place."
          points={[
            "A photograph bin that holds up to a thousand, from which the family picks the fifty or so for the slideshow. Nothing they leave out is deleted.",
            "iPhone HEIC photographs arrive as ordinary JPEGs. A portrait crop is stored as instructions, so the original stays untouched.",
            "The obituary as named fields (born, survived by, in lieu of flowers) rather than a blank box, and the hymns, readings and pallbearers as short lists.",
            "The photo pack downloads as one ZIP in slideshow order, numbered and captioned, with a captions file for the order of service.",
          ]}
          visual={
            <Pair
              desk={<Desk screen={screens.consolePhotos} sizes={deskSizes} />}
              phone={<Phone screen={screens.familyPhotos} sizes={phoneSizes} />}
              caption="The family adds photographs on a phone; your staff see who sent each one and download the pack."
            />
          }
        />

        <Feature
          number="Two"
          id="f-thread"
          flip
          title="One contained thread"
          lede="Everyone on the family's side sees the same conversation, so you answer once and the “who told you that?” arguments settle themselves."
          points={[
            <>
              Office hours are shown, never enforced. A 2am message is delivered at 2am, and before
              they send it the family is told when it will be read, with your 24-hour number beside
              it.
            </>,
            "Every family's thread also lands in one inbox in the console, with the ones waiting on you first.",
            "The thread locks two weeks after the service, for both sides, so it ends. It stays readable; the period is yours to change.",
          ]}
          visual={
            <Pair
              desk={<Desk screen={screens.consoleMessages} sizes={deskSizes} />}
              phone={<Phone screen={screens.familyMessages} sizes={phoneSizes} />}
              caption="Late at night, the family sees when their message will be read, and who to call if it can't wait."
            />
          }
        />

        <Feature
          number="Three"
          id="f-timeline"
          title="A timeline in plain words"
          lede="Four or five dated things the family needs to know: when the photographs are needed, when to bring the clothing, when the proof is ready to check."
          points={[
            "You write your standard schedule once, as days before the service. Every case gets it automatically the moment it has a service date.",
            "Events, such as the funeral itself, are kept apart from tasks, and cannot be ticked off.",
            "When your staff tick something off, the family sees it done and by whom.",
          ]}
          visual={
            <PhoneFigure
              phone={<Phone screen={screens.familyTimeline} sizes={soloPhone} />}
              caption="What the family sees: what's done, what's still to do, and the service."
            />
          }
        />

        <Feature
          number="Four"
          id="f-aftercare"
          flip
          title="Aftercare that costs no staff hours"
          lede="Closing a case offers the family check-ins at thirty, sixty and ninety days and on the anniversary, signed in your home's name."
          points={[
            "Nothing is sent until the family says yes. They are shown the actual dates, and “No, thank you” is the same size as “Yes, please”. A no is final.",
            "A family already enrolled keeps receiving their check-ins even if you later stop paying for aftercare, or leave. Somebody promised them, in your name.",
            "Included in the trial, so you see a thirty-day check-in go out before you decide anything.",
          ]}
          visual={
            <PhoneFigure
              phone={<Phone screen={screens.familyAftercare} sizes={soloPhone} />}
              caption="The family is asked, shown the dates, and can decline as easily as accept."
            />
          }
        />

        <Feature
          number="Five"
          id="f-master"
          title="The master page"
          lede="The screen a director opens first, and the only one not about a single case."
          points={[
            "Who is waiting on a reply, what went past due while you were at a graveside, and what is happening this week.",
            "Which cases have no service date yet. Every step of the schedule counts from the service, so a case without one is a family who has been told nothing.",
            "Where you keep what is yours rather than any one family's: your public page and its request form, the policies you repeat at every table, your standard schedule.",
          ]}
          visual={
            <figure>
              <Panel>
                <Desk screen={screens.consoleInbox} sizes={deskSizes} />
              </Panel>
              <figcaption className="mt-4 text-sm text-muted-foreground">
                Every family's messages in one place, the ones waiting on you first.
              </figcaption>
            </figure>
          }
        />
      </div>
    </Section>
  );
}

const isNot: { title: string; body: string }[] = [
  {
    title: "Not a case-management system",
    body: "You already own one, and it stays. There are no contracts, invoices or venue bookings in here. Holding Today holds the part your system never did: the work with the family.",
  },
  {
    title: "No price list in front of your families",
    body: "No General Price List, no statement, no prices on the family's screen or your public page. You can keep a staff-only price sheet for the arrangement table, and the build fails if any family or public page can ever read it.",
  },
  {
    title: "Nothing charged to your families, ever",
    body: "Not for the obituary, the photographs they uploaded, or anything else, including after you cancel. We take no payments from families and hold no card details, so there is nothing to sell them.",
  },
  {
    title: "Not a booking system",
    body: "You can offer a family a choice of service times you have already confirmed by telephone. It never claims a church or a cemetery is free; they keep their own calendars.",
  },
];

function WhatItIsNot() {
  return (
    <Section
      id="what-it-is-not"
      labelledBy="not-title"
      className="bg-accent-deep py-20 text-white sm:py-24"
    >
      <div className="max-w-2xl">
        <p className="eyebrow !text-[#b9d3cc]">What it deliberately is not</p>
        <h2 id="not-title" className="mt-3 text-3xl sm:text-4xl">
          The lines we drew, and why they protect you.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-[#d7e4e0]">
          The FTC Funeral Rule governs how you disclose prices, and your families trust your name, not
          ours. These omissions are decisions, and the two that touch your licence and your
          families' money are enforced by tests that fail the build, not by good intentions.
        </p>
      </div>
      <ul className="mt-12 grid gap-5 sm:grid-cols-2">
        {isNot.map((item) => (
          <li key={item.title} className="rounded-xl border border-white/15 bg-white/[0.06] p-6 sm:p-7">
            <h3 className="flex items-start gap-3 text-xl">
              <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Icon name="minus" className="size-4" />
              </span>
              {item.title}
            </h3>
            <p className="mt-3 leading-relaxed text-[#d7e4e0]">{item.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const security: { title: string; body: ReactNode }[] = [
  {
    title: "Family links are stored as a fingerprint",
    body: "We keep only the SHA-256 hash of each family's link, never the link itself. A link reaches exactly one case, expires after 90 days, and you can switch it off in one click.",
  },
  {
    title: "Photographs and social security numbers are encrypted",
    body: "With AES-256-GCM, before they are written to the database. The key is never stored in the database, and backups are encrypted as whole files.",
  },
  {
    title: "Your home's data is walled off from every other home's",
    body: "Every record carries your home, and every staff request is filtered by the home of the person signed in, never by anything in the request. Automated tests try to cross that line and must fail.",
  },
  {
    title: "Every time we look, it is written down first",
    body: "Our own staff reach your data only through an access list that is empty by default, and each look is logged, naming who and what, before the data comes back. Ask for every entry about your home.",
  },
  {
    title: "Your data leaves when you say so",
    body: "Any case exports as a folder of photographs and plain text that opens without this software, and still exports after you cancel. Erasing a case destroys the encrypted photographs themselves, not just the reference to them, and copies in backups age out with the backups.",
  },
  {
    title: "Nothing is sold, tracked or used for training",
    body: "No analytics, no advertising, no tracking across other sites, and none of it is used to train any AI model. Case content reaches none of the services we send mail or bills through.",
  },
];

function Security() {
  return (
    <Section id="security" labelledBy="security-title" className="py-20 sm:py-24">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <div>
          <p className="eyebrow">Security and privacy</p>
          <h2 id="security-title" className="mt-3 text-3xl sm:text-4xl">
            In plain words, because your families' details deserve them.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            You are the controller of your families' information; we hold it for you and act on your
            instructions. Every statement here was written against the code that makes it true, and
            changes when the code does.
          </p>
          <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-card">
            <h3 className="flex items-center gap-2.5 text-lg">
              <Icon name="lock" className="size-5 text-accent" />
              Data processing agreement
            </h3>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              A data processing agreement, written against the code rather than from a template, is
              available on request for you and your insurer.
            </p>
            {contactHref && (
              <a href={contactHref} className="mt-3 inline-block font-semibold text-accent">
                Ask for a copy
              </a>
            )}
          </div>
        </div>

        <div>
          <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {security.map((item) => (
              <li key={item.title}>
                <h3 className="text-lg">{item.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 rounded-xl border border-notice/20 bg-notice-soft p-5 leading-relaxed text-[#6b4520]">
            <strong className="font-semibold">One thing we would rather you heard from us.</strong>{" "}
            Photographs over 3000 pixels are re-processed on the way in and lose their hidden camera
            data, including any location. Smaller ones are kept exactly as sent, and keep it. We say
            so rather than let you assume a photo pack has been cleaned.
          </p>
        </div>
      </div>
    </Section>
  );
}

function Pricing() {
  return (
    <Section id="pricing" labelledBy="pricing-title" className="border-y border-border bg-card py-20 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Pricing</p>
        <h2 id="pricing-title" className="mt-3 text-3xl sm:text-4xl">
          Free while you try it. Talk to us about the rest.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          We have not published prices yet, and we will not guess at one here.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
        <div className="flex flex-col rounded-2xl border-2 border-accent bg-background p-7 shadow-raised sm:p-8">
          <h3 className="text-2xl">The trial</h3>
          <p className="mt-1 font-display text-4xl text-accent-deep">30 days free</p>
          <ul className="mb-8 mt-6 space-y-3">
            {[
              "Every feature, including aftercare",
              "No card needed to start",
              "Your own cases and your own families from the first day",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <Icon name="check" className="mt-1 size-4 shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <a href={trialHref} className={`${buttonPrimary} mt-auto`}>
            Start a free trial
          </a>
        </div>

        <div className="flex flex-col rounded-2xl border border-border bg-background p-7 sm:p-8">
          <h3 className="text-2xl">After the trial</h3>
          <p className="mt-1 font-display text-4xl text-foreground">Talk to us</p>
          <ul className="mb-8 mt-6 space-y-3">
            {[
              "Priced per location, with a charge per funeral served, so a small home is not paying what a large one does",
              "A pre-need file is not billed until it becomes a funeral, and no funeral is billed twice",
              "Group pricing for several locations on one invoice",
              "Your families pay nothing, ever",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <Icon name="check" className="mt-1 size-4 shrink-0 text-accent" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {contactHref ? (
            <a href={contactHref} className={`${buttonSecondary} mt-auto`}>
              Email {contactEmail}
            </a>
          ) : (
            <p className="mt-auto text-sm text-muted-foreground">Ask from inside the console.</p>
          )}
        </div>
      </div>
    </Section>
  );
}

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "Do our families need an app or an account?",
    a: "No. They get a link by text message and it opens in the phone's browser. There is nothing to install and no password to choose, because a registration form in the week of a death is where people give up.",
  },
  {
    q: "What if a link ends up with the wrong person?",
    a: "Switch it off from the case in one click and send a fresh one; the old one stops working at once. Links also expire on their own, normally 90 days after they are sent, and only a fingerprint of each link is stored.",
  },
  {
    q: "Does it replace our case-management system?",
    a: "No, and it is not meant to. Keep your contracts, your price list and your records where they are. Holding Today is for the collaboration with the family, which that system was never built for.",
  },
  {
    q: "Will our name or our prices appear anywhere a family can see?",
    a: "Your name, yes: the family portal carries your home's name, mark and colour, and ours does not appear on it. Your prices, never. There is no setting that would show a price to a family or on your public page.",
  },
  {
    q: "How do families find us before there is a case?",
    a: "Each home gets a public page with its own words, its policies and a request form, which you can link from your own website. A request lands with your staff; nothing is opened until one of you accepts it.",
  },
  {
    q: "Does it help with prayer cards and orders of service?",
    a: "Yes. There are six ready-made layouts at real trade sizes, including prayer cards, bookmarks, folded and single-sheet orders of service, register pages and thank-you cards. Most of each layout fills itself from the case, and it prints from any browser with a standard bleed.",
  },
  {
    q: "What happens to our data if we leave?",
    a: "Export any case as a folder of photographs and plain text that opens without us; exports keep working after you cancel. Families already enrolled in aftercare keep their check-ins. While you are with us, nothing about a case is deleted on a timer: how long you keep records is set by your state and your insurer, so it is your decision, not ours.",
  },
  {
    q: "Is the trial really free?",
    a: "Yes. Thirty days from the day you register, with no card needed to start. Funerals you handle during the trial are counted, so you can see them, and then waived.",
  },
];

function Faq() {
  return (
    <Section id="faq" labelledBy="faq-title" className="py-20 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 id="faq-title" className="mt-3 text-3xl sm:text-4xl">
            What directors ask us first.
          </h2>
          {contactHref && (
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Anything else, write to{" "}
              <a href={contactHref} className="font-semibold text-accent">
                {contactEmail}
              </a>
              .
            </p>
          )}
        </div>
        <div className="divide-y divide-border border-y border-border">
          {faqs.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex items-start justify-between gap-6 py-5 text-lg font-semibold">
                <span>{item.q}</span>
                <Icon name="chevron" className="chevron mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-200" />
              </summary>
              <p className="-mt-1 pb-6 pr-10 leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

function ClosingCall() {
  return (
    <Section labelledBy="closing-title" className="pb-20 sm:pb-24">
      <div className="rounded-3xl bg-accent-deep px-6 py-14 text-center text-white sm:px-12 sm:py-16">
        <h2 id="closing-title" className="mx-auto max-w-2xl text-3xl sm:text-4xl">
          Give your next family one link instead of your email address.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-[#d7e4e0]">
          Add your name and colour, your office hours and 24-hour number, and your standard schedule.
          Then open a case and send the family their link.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href={trialHref} className={`${buttonPrimary} !bg-white !text-accent-deep hover:!bg-accent-soft`}>
            Start a free trial
          </a>
          {contactHref && (
            <a
              href={contactHref}
              className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 font-semibold text-white no-underline hover:bg-white/10"
            >
              Talk to us
            </a>
          )}
        </div>
      </div>
    </Section>
  );
}

function Footer() {
  const legalPending = !privacyHref || !termsHref;
  return (
    <footer className="border-t border-border bg-sunken">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Family portal software for funeral homes. Screens on this page show an invented funeral
            home and invented families.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Product</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><a href="#how-it-works" className="text-muted-foreground no-underline hover:text-foreground">How it works</a></li>
            <li><a href="#security" className="text-muted-foreground no-underline hover:text-foreground">Security</a></li>
            <li><a href="#pricing" className="text-muted-foreground no-underline hover:text-foreground">Pricing</a></li>
            {signInHref && (
              <li><a href={signInHref} className="text-muted-foreground no-underline hover:text-foreground">Sign in</a></li>
            )}
          </ul>
        </nav>
        <div>
          <h2 className="font-sans text-sm font-semibold tracking-normal">Company</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {contactHref && (
              <li><a href={contactHref} className="text-muted-foreground no-underline hover:text-foreground">{contactEmail}</a></li>
            )}
            <li>
              {privacyHref ? (
                <a href={privacyHref} className="text-muted-foreground no-underline hover:text-foreground">Privacy</a>
              ) : (
                <a href="#legal" className="text-muted-foreground no-underline hover:text-foreground">Privacy</a>
              )}
            </li>
            <li>
              {termsHref ? (
                <a href={termsHref} className="text-muted-foreground no-underline hover:text-foreground">Terms</a>
              ) : (
                <a href="#legal" className="text-muted-foreground no-underline hover:text-foreground">Terms</a>
              )}
            </li>
          </ul>
        </div>
      </div>
      {legalPending && (
        <div id="legal" className="border-t border-border">
          <p className="mx-auto w-full max-w-6xl px-4 py-6 text-sm leading-relaxed text-muted-foreground sm:px-6 lg:px-8">
            Our terms of service, privacy policy and data processing agreement are written but not
            yet published. Copies of the current drafts are available on request{contactHref ? (
              <>
                {" "}from <a href={contactHref} className="text-accent">{contactEmail}</a>
              </>
            ) : null}
            .
          </p>
        </div>
      )}
    </footer>
  );
}

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1}>
        <span id="top" />
        <Hero />
        <Problem />
        <Features />
        <WhatItIsNot />
        <Security />
        <Pricing />
        <Faq />
        <ClosingCall />
      </main>
      <Footer />
    </>
  );
}
