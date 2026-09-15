import { voiceFor } from "@/lib/voice";
import { Link } from "wouter";
import {
  useGetFamilySession,
  useGetFamilyDeadlines,
} from "@workspace/api-client-react";
import {
  Images,
  FileText,
  ListMusic,
  Shirt,
  ClipboardList,
  FileCheck,
  MapPin,
  CalendarClock,
  MessageCircle,
  HeartHandshake,
  ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * The one screen a family lands on, and the only one that has to make sense
 * to somebody who was told "they'll text you a link" and nothing else.
 *
 * It answers three questions in order: when is the funeral, what needs me,
 * and what can I do. Everything else is a tap away and nothing is nested
 * twice.
 *
 * The last of those three used to be a run of ten identical cards, which is
 * a wall — the eye has nowhere to rest and no way to guess where a thing
 * lives. They are now in four named groups. Nothing was added, removed or
 * buried; the list is simply set the way a printed contents page would be
 * set, so that "where do I put the photographs" is answered by looking
 * rather than by reading all ten.
 */

function formatWhen(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

type CardProps = {
  href: string;
  icon: typeof Images;
  title: string;
  detail: string;
  badge?: number;
};

function Card({ href, icon: Icon, title, detail, badge }: CardProps) {
  return (
    <Link
      href={href}
      className="lift group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4
                 no-underline shadow-[var(--elevation-1)] transition-gentle
                 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]"
    >
      <span
        className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]
                   text-[var(--accent-deep)] ring-1 ring-inset ring-[var(--accent)]/10
                   transition-gentle group-hover:ring-[var(--accent)]/25"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="tabular rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-white">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
          {detail}
        </span>
      </span>
      <ChevronRight
        className="size-5 shrink-0 text-muted-foreground/60 transition-gentle
                   group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
      />
    </Link>
  );
}

/**
 * A named group of cards. The label is set the way a section marker is set on
 * an order of service: small, letterspaced, with a hairline carrying it
 * across the page.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow">{label}</h2>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export default function Hub() {
  const session = useGetFamilySession();
  const deadlines = useGetFamilyDeadlines();

  if (!session.data) return null;

  const {
    case: deceased,
    home,
    leadDirector,
    photoCount,
    photoLimit,
    obituaryStatus,
    outstandingDeadlines,
    unreadMessages,
    messagesLocked,
    awaitingServiceChoice,
    aftercare,
  } = session.data;

  const serviceWhen = formatWhen(deceased.serviceAt);
  const voice = voiceFor(deceased.kind);

  // The soonest thing that is actually due. One is useful; a list of five on
  // the front page is a wall a grieving person bounces off.
  const nextDue = (deadlines.data ?? [])
    .filter((entry) => !entry.isEvent && entry.completedAt === null)
    .sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    )[0];

  return (
    <div className="space-y-8">
      {/*
        The name, and then the one fact everybody rings up to ask. The date is
        set in the serif at reading size rather than as small grey metadata,
        because for the first week it is the only thing on this screen most
        people have come for.
      */}
      <section>
        <h1 className="font-display text-[1.75rem] leading-tight">
          {voice.heading(deceased.displayName)}
        </h1>
        {serviceWhen ? (
          <div className="mt-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-4 shadow-[var(--elevation-1)]">
            <p className="eyebrow mb-1.5 text-[var(--accent-deep)]/75">
              The service
            </p>
            <p className="font-display text-lg leading-snug text-[var(--accent-deep)]">
              {serviceWhen}
            </p>
            {deceased.serviceLocation && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {deceased.serviceLocation}
              </p>
            )}
          </div>
        ) : voice.preNeed ? (
          <p className="mt-2 text-muted-foreground">
            Nothing here is fixed, and nothing is decided today. Add what you
            know, leave the rest, and come back whenever you like.
          </p>
        ) : (
          <p className="mt-2 text-muted-foreground">
            {home.name} will confirm the service details with you.
          </p>
        )}
      </section>

      {/*
        Above the aftercare question and above what is due, because it is the
        only thing on this screen that other people are waiting on. Every
        other card here can sit until the family is ready; a date the home
        cannot confirm is holding up the church, the printer and the florist.
      */}
      {awaitingServiceChoice && (
        <section className="relative overflow-hidden rounded-xl border border-border bg-card px-4 py-4 pl-5 shadow-[var(--elevation-1)]">
          {/* The same rule down the edge that marks what is due next. This is
              the one card on the screen that somebody else is waiting on. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]"
          />
          <p className="eyebrow mb-1">The date</p>
          <p className="font-semibold">
            {home.name} can offer you a choice of times
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Whichever suits your family. There is no better answer.
          </p>
          <Link
            href="/service-time"
            className="mt-3 inline-block text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
          >
            See the times
          </Link>
        </section>
      )}

      {/*
        Asked once, at the top, and only while it is undecided. A consent
        question that keeps reappearing after somebody has answered it is the
        thing that turns a kindness into a nuisance.
      */}
      {aftercare?.status === "pending" && (
        <section className="rounded-xl border border-border bg-card px-4 py-4 shadow-[var(--elevation-1)]">
          <p className="font-semibold">
            Would you like {home.name} to check in?
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A few short notes over the next year. You can say no.
          </p>
          <Link
            href="/aftercare"
            className="mt-3 inline-block text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
          >
            Have a look at what would arrive
          </Link>
        </section>
      )}

      {nextDue && (
        <section className="relative overflow-hidden rounded-xl border border-border bg-card px-4 py-4 pl-5 shadow-[var(--elevation-1)]">
          {/* A rule in the home's colour down the edge, rather than a full
              wash. It marks the card as the live one without shouting. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]"
          />
          <p className="eyebrow mb-1">Next</p>
          <p className="font-semibold">{nextDue.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatWhen(nextDue.dueAt)}
          </p>
        </section>
      )}

      <div className="space-y-7">
        <Group label="About them">
          <Card
            href="/photos"
            icon={Images}
            title="Photographs"
            detail={
              photoCount === 0
                ? `Add up to ${photoLimit} for the service`
                : `${photoCount} of ${photoLimit} added`
            }
          />
          <Card
            href="/obituary"
            icon={FileText}
            title="The obituary"
            detail={
              obituaryStatus === "approved"
                ? "Approved by the funeral home"
                : obituaryStatus === "submitted"
                  ? "With the funeral home"
                  : "Tell us about them"
            }
          />
          <Card
            href="/belongings"
            icon={Shirt}
            title="Clothing and belongings"
            detail="What they'll wear, and how they looked"
          />
        </Group>

        <Group label="For the service">
          <Card
            href="/service"
            icon={ListMusic}
            title="Hymns and readings"
            detail="Music, readings, and who will carry"
          />
          <Card
            href="/proofs"
            icon={FileCheck}
            title="Things to check"
            detail="Read the spellings before anything is printed"
          />
        </Group>

        <Group label="Paperwork and what's due">
          <Card
            href="/certificate"
            icon={ClipboardList}
            title="Details for the certificate"
            detail="What the state needs before it can be issued"
          />
          <Card
            href="/timeline"
            icon={CalendarClock}
            title="What's due"
            detail={
              outstandingDeadlines === 0
                ? "Nothing outstanding"
                : `${outstandingDeadlines} still to do`
            }
            badge={outstandingDeadlines}
          />
          <Card
            href="/local"
            icon={MapPin}
            title="Local help"
            detail="Headstones, cemeteries, and who to ask"
          />
        </Group>

        {(!messagesLocked || aftercare?.status === "active") && (
          <Group label="Your funeral home">
            {!messagesLocked && (
              <Card
                href="/messages"
                icon={MessageCircle}
                title="Ask a question"
                detail={
                  leadDirector?.displayName
                    ? `${leadDirector.displayName} will answer`
                    : `Message ${home.name}`
                }
                badge={unreadMessages}
              />
            )}
            {aftercare?.status === "active" && (
              <Card
                href="/aftercare"
                icon={HeartHandshake}
                title="Checking in"
                detail={`${home.name} will write a few times over the year`}
              />
            )}
          </Group>
        )}
      </div>

      <p className="border-t border-border pt-6 text-sm leading-relaxed text-muted-foreground">
        Take these in any order, and leave them half-finished if you need to.
        Everything saves as you go.
      </p>
    </div>
  );
}
