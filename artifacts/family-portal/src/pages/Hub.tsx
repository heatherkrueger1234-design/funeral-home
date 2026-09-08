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
  MapPin,
  CalendarClock,
  MessageCircle,
  HeartHandshake,
  ChevronRight,
} from "lucide-react";

/**
 * The one screen a family lands on, and the only one that has to make sense
 * to somebody who was told "they'll text you a link" and nothing else.
 *
 * It answers three questions in order: when is the funeral, what needs me,
 * and what can I do. Everything else is a tap away and nothing is nested
 * twice.
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
      className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 hover:border-[var(--accent)] transition-colors"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs text-white">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-sm text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </Link>
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
    aftercare,
  } = session.data;

  const serviceWhen = formatWhen(deceased.serviceAt);

  // The soonest thing that is actually due. One is useful; a list of five on
  // the front page is a wall a grieving person bounces off.
  const nextDue = (deadlines.data ?? [])
    .filter((entry) => !entry.isEvent && entry.completedAt === null)
    .sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    )[0];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-2xl mb-1">{deceased.displayName}</h1>
        {serviceWhen ? (
          <p className="text-muted-foreground">
            {serviceWhen}
            {deceased.serviceLocation ? ` · ${deceased.serviceLocation}` : ""}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {home.name} will confirm the service details with you.
          </p>
        )}
      </section>

      {/*
        Asked once, at the top, and only while it is undecided. A consent
        question that keeps reappearing after somebody has answered it is the
        thing that turns a kindness into a nuisance.
      */}
      {aftercare?.status === "pending" && (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4">
          <p className="font-medium mb-1">Would you like {home.name} to check in?</p>
          <p className="text-sm text-muted-foreground mb-3">
            A few short notes over the next year. You can say no.
          </p>
          <Link
            href="/aftercare"
            className="text-sm font-medium text-[var(--accent-deep)] underline"
          >
            Have a look at what would arrive
          </Link>
        </section>
      )}

      {nextDue && (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4">
          <p className="text-xs uppercase tracking-wide text-[var(--accent-deep)] mb-1">
            Next
          </p>
          <p className="font-medium">{nextDue.title}</p>
          <p className="text-sm text-muted-foreground">
            {formatWhen(nextDue.dueAt)}
          </p>
        </section>
      )}

      <section className="space-y-3">
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
        <Card
          href="/service"
          icon={ListMusic}
          title="Hymns and readings"
          detail="Music, readings, and who will carry"
        />
        <Card
          href="/local"
          icon={MapPin}
          title="Local help"
          detail="Headstones, cemeteries, and who to ask"
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
      </section>

      <p className="text-sm text-muted-foreground">
        Take these in any order, and leave them half-finished if you need to.
        Everything saves as you go.
      </p>
    </div>
  );
}
