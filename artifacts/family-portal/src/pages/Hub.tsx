import { voiceFor } from "@/lib/voice";
import { formatAtHome } from "@/lib/utils";
import { nextDue } from "@/lib/next-due";
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
  BookHeart,
  Users,
  ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLink } from "@/lib/link";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

/** On the home's clock — see `formatAtHome`. */
function formatWhen(
  value: string | Date | null | undefined,
  timeZone: string,
): string | null {
  return (
    formatAtHome(value, timeZone, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
    }) || null
  );
}

/**
 * The service's date and its time, apart. Run together at the size the hero
 * card sets them, "Monday, September 28 at 4:07 PM" breaks on a phone
 * between the month and the day — the one line on this screen people have
 * come to read, torn in half. Two lines, each whole, and the time a step
 * smaller beneath the date, the way an invitation sets them.
 */
function splitWhen(
  value: string | Date | null | undefined,
  timeZone: string,
): { date: string; time: string } | null {
  const date = formatAtHome(value, timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (!date) return null;

  return {
    date,
    time: formatAtHome(value, timeZone, { hour: "numeric", minute: "2-digit" }),
  };
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
    <li>
      <Link
        href={href}
        className="group flex items-center gap-4 px-4 py-3.5 no-underline transition-gentle
                   hover:bg-[var(--sunken)] focus-visible:bg-[var(--sunken)]"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]
                     text-[var(--accent-deep)] ring-1 ring-inset ring-[var(--accent)]/10
                     transition-gentle group-hover:ring-[var(--accent)]/30"
        >
          <Icon className="size-[1.125rem]" strokeWidth={1.6} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-semibold">{title}</span>
            {badge !== undefined && badge > 0 && (
              <span className="tabular rounded-full bg-[var(--accent)] px-2 py-0.5 text-sm font-semibold leading-tight text-white">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
            {detail}
          </span>
        </span>
        <ChevronRight
          className="size-[1.125rem] shrink-0 text-muted-foreground/50 transition-gentle
                     group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
          strokeWidth={1.75}
        />
      </Link>
    </li>
  );
}

/**
 * A named group, set as one card with its entries ruled off inside it —
 * the way a printed contents page lists its sections — rather than as a
 * stack of separate tiles. Ten floating tiles read as an app's menu; three
 * or four ruled lists read as something a person arranged.
 *
 * The label is set the way a section marker is set on an order of service:
 * small, letterspaced, with a hairline carrying it across the page.
 */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow">{label}</h2>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      <ul
        className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card
                   shadow-[var(--elevation-1)]"
      >
        {children}
      </ul>
    </section>
  );
}

export default function Hub() {
  const session = useGetFamilySession();
  const deadlines = useGetFamilyDeadlines();

  if (!session.data) return null;

  const {
    case: deceased,
    contact,
    home,
    leadDirector,
    photoCount,
    photoLimit,
    selectedPhotoCount,
    obituaryStatus,
    outstandingDeadlines,
    unreadMessages,
    messagesLocked,
    proofsToCheck,
    awaitingServiceChoice,
    aftercare,
  } = session.data;

  const serviceWhen = splitWhen(deceased.serviceAt, home.timezone);
  const voice = voiceFor(deceased.kind);

  // Soonest thing still ahead; what slipped by is counted, not headlined.
  // See `nextDue` for why the two are no longer the same thing.
  const now = Date.now();
  const {
    next: nextDueItem,
    ahead: nextIsAhead,
    slipped,
  } = nextDue(deadlines.data ?? [], now);
  const serviceIsPast =
    deceased.serviceAt !== null && new Date(deceased.serviceAt).getTime() < now;

  return (
    <div className="space-y-8">
      {/*
        The name, and then the one fact everybody rings up to ask. The date is
        set in the serif at reading size rather than as small grey metadata,
        because for the first week it is the only thing on this screen most
        people have come for.
      */}
      <section className="pt-2 text-center">
        <div className="ornament mx-auto mb-5 max-w-[10rem]" aria-hidden>
          <i />
        </div>
        <h1 className="font-display text-[2.125rem] leading-[1.1]">
          {voice.heading(deceased.displayName)}
        </h1>
        {serviceWhen ? (
          /*
            Set like the card tucked into a sympathy envelope: white stock,
            a brass line ruled just inside the edge, everything centred.
          */
          <div className="engraved mt-6 rounded-xl border border-[var(--brass-soft)] bg-card px-6 py-6">
            <p className="eyebrow mb-2.5 text-[var(--accent-deep)]/80">
              {/* Weeks later, in the aftercare months, it is a day that
                  happened rather than one to get ready for. */}
              {serviceIsPast ? "The service was held on" : "The service"}
            </p>
            <p className="font-display text-[1.3rem] leading-snug text-[var(--accent-deep)]">
              {serviceWhen.date}
            </p>
            <p className="tabular mt-0.5 text-[var(--accent-deep)]/85">
              {serviceWhen.time}
            </p>
            {deceased.serviceLocation && (
              <>
                <span
                  aria-hidden
                  className="mx-auto my-3 block h-px w-8 bg-[var(--brass)]/50"
                />
                <p className="text-sm text-muted-foreground">
                  {deceased.serviceLocation}
                </p>
              </>
            )}
          </div>
        ) : voice.preNeed ? (
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Nothing here is fixed, and nothing is decided today. Add what you
            know, leave the rest, and come back whenever you like.
          </p>
        ) : (
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
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
            className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent)]"
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
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
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
            className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-deep)] decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
          >
            Have a look at what would arrive
          </Link>
        </section>
      )}

      {/*
        The session already says how many things are outstanding, and it
        arrives first. When there are some, the card is drawn at once and its
        words fill in when the list lands, rather than the card appearing a
        beat later and pushing everything below it down the screen.
      */}
      {(nextDueItem || (deadlines.isPending && outstandingDeadlines > 0)) && (
        /*
          The whole card is the way in to the list it summarises. It used to
          be a card with nothing to press, which on a phone reads as a
          button that does not work.
        */
        <Link
          href="/timeline"
          className="group relative block overflow-hidden rounded-xl border border-border bg-card px-4 py-4 pl-5
                     text-foreground no-underline shadow-[var(--elevation-1)] transition-gentle
                     hover:border-[var(--accent)]/40"
        >
          {/* A rule in the home's colour down the edge, rather than a full
              wash. It marks the card as the live one without shouting. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] bg-[var(--accent)]"
          />
          <p className="eyebrow mb-1">Next</p>
          {nextDueItem ? (
            <>
              <p className="font-semibold">{nextDueItem.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {nextIsAhead
                  ? formatWhen(nextDueItem.dueAt, home.timezone)
                  : `Hoped for by ${formatWhen(nextDueItem.dueAt, home.timezone)}. If it can't be done, tell ${home.name} — it can move.`}
              </p>
              {nextIsAhead && slipped.length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {slipped.length === 1
                    ? "One thing from earlier in the week is still open."
                    : `${slipped.length} things from earlier in the week are still open.`}{" "}
                  The dates can move.
                </p>
              )}
            </>
          ) : (
            <div className="animate-pulse" role="status" aria-label="Loading">
              <p className="font-semibold">
                <span className="inline-block h-4 w-2/3 rounded bg-[var(--muted)] align-middle" />
              </p>
              <p className="mt-0.5 text-sm">
                <span className="inline-block h-3 w-1/3 rounded bg-[var(--muted)]/70 align-middle" />
              </p>
            </div>
          )}
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-deep)]">
            See everything that's due
            <ChevronRight
              aria-hidden
              className="size-4 transition-gentle group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </span>
        </Link>
      )}

      <div className="space-y-7">
        <Group label={voice.preNeed ? "About you" : "About them"}>
          <Card
            href="/photos"
            icon={Images}
            title="Photographs"
            /*
              What is there and what has been chosen, never the ceiling. "9 of
              1000" read as a quota the family had barely started on; the
              limit is the server's business until they are near it.
            */
            detail={
              photoCount === 0
                ? "Add any you have, from any album"
                : photoLimit - photoCount <= 50
                  ? `${photoCount} added — room for ${Math.max(0, photoLimit - photoCount)} more`
                  : selectedPhotoCount > 0
                    ? `${photoCount} added, ${selectedPhotoCount} chosen for the slideshow`
                    : `${photoCount} added`
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
                  : voice.preNeed
                    ? "In your own words, if you like"
                    : "Tell us about them"
            }
          />
          <Card
            href="/belongings"
            icon={Shirt}
            title="Clothing and belongings"
            detail={
              voice.preNeed
                ? "What you'd like to wear, and how you like to look"
                : "What they'll wear, and how they looked"
            }
          />
          {/*
            Not offered on a pre-need file: a book of memories is written
            about somebody who has died, and the person reading this one is
            alive and planning their own funeral.
          */}
          {!voice.preNeed && (
            <Card
              href="/memory-book"
              icon={BookHeart}
              title="The memory book"
              detail="Memories and the story of their life, in a book to keep"
            />
          )}
        </Group>

        {/*
          Only for somebody the home has allowed to pass the link on (the
          next of kin, by default), and not once the arrangements are closed
          -- the route refuses both, so the card would be a dead end.
        */}
        {contact.canInvite && deceased.status !== "closed" && (
          <Group label="Family">
            <Card
              href="/family"
              icon={Users}
              title="Bring in family"
              detail="Give a relative their own link, so they can help too"
            />
          </Group>
        )}

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
            detail={
              proofsToCheck > 0
                ? `${proofsToCheck === 1 ? "One is" : `${proofsToCheck} are`} waiting for you to read`
                : "Read the spellings before anything is printed"
            }
            badge={proofsToCheck}
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
            // No count badge beside the words: "3" in a filled circle and
            // "3 still to do" under it was the same fact said twice, and the
            // circle is the half that reads as a score.
            detail={
              outstandingDeadlines === 0
                ? "Nothing outstanding"
                : `${outstandingDeadlines} still to do`
            }
          />
          <Card
            href="/local"
            icon={MapPin}
            title="Local help"
            detail="Headstones, cemeteries, and who to ask"
          />
        </Group>

        {/*
          Kept once the conversation is closed, read-only: the director's last
          messages are often the ones with the practical details in them, and
          a family should be able to find them again.
        */}
        <Group label="Your funeral home">
          <Card
            href="/messages"
            icon={MessageCircle}
            title={messagesLocked ? "Your messages" : "Ask a question"}
            detail={
              messagesLocked
                ? "The conversation, to read back"
                : leadDirector?.displayName
                  ? `${leadDirector.displayName} will answer`
                  : `Message ${home.name}`
            }
            badge={unreadMessages}
          />
          {aftercare?.status === "active" && (
            <Card
              href="/aftercare"
              icon={HeartHandshake}
              title="Checking in"
              detail={`${home.name} will write a few times over the year`}
            />
          )}
        </Group>
      </div>

      {/*
        No rule above this. The shell draws one immediately below it, to carry
        the 24-hour number, and two hairlines forty pixels apart with one
        sentence between them is a line nobody meant to draw.
      */}
      <p className="mx-auto max-w-sm pt-1 text-center text-sm leading-relaxed text-muted-foreground">
        Take these in any order, and leave them half-finished if you need to.
        Everything saves as you go.
      </p>

      <ForgetThisPhone />
    </div>
  );
}

/**
 * The way to take the link back off a phone that is not yours.
 *
 * The portal remembers the link so that nobody has to dig the text message
 * out again tomorrow (lib/link.tsx), which is right for the family's own
 * phone and wrong for a hospital tablet, a friend's phone borrowed in the
 * car park, or a relative's laptop — where it would leave the next person
 * one tap from the family's photographs. The means to forget it existed and
 * nothing offered it.
 */
function ForgetThisPhone() {
  const { forget } = useLink();
  const queryClient = useQueryClient();

  return (
    <div className="text-center">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground underline decoration-border underline-offset-4"
          >
            Using someone else's phone or computer?
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget the link on this device?</AlertDialogTitle>
            <AlertDialogDescription>
              This page will stop opening here until the link is opened again
              from your message. Nothing anyone has added is lost, and the
              link keeps working on your own phone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                forget();
                // What this tab has already loaded goes too, not just the key.
                queryClient.clear();
              }}
            >
              Forget it here
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
