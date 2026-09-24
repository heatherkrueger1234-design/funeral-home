import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, formatDateTime, type PlatformOverview } from "@/lib/api";
import {
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingRows,
  Skeleton,
  Stat,
  Swatch,
} from "@/components/ui";
import { Reminders } from "@/components/Reminders";

/**
 * The first screen, and it answers the three questions in the order they are
 * actually asked: how many customers are there, which of them is about to
 * have a problem with DORA, and how much of the product is being used.
 *
 * Licensure comes second and engagement third on purpose. In Colorado in
 * 2026 the middle section is the one that earns the subscription.
 */
export function Overview() {
  const query = useQuery({
    queryKey: ["overview"],
    queryFn: () => api.get<PlatformOverview>("/admin/overview"),
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-32 w-full" />
        <LoadingRows rows={3} />
      </div>
    );
  }

  if (query.error) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { homes, engagement, attention } = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl leading-tight">Overview</h1>
        <p className="mt-1 text-[var(--muted-foreground)]">
          {homes.homes === 0 ? (
            <>
              No homes yet.{" "}
              <Link href="/homes" className="text-[var(--foreground)] underline">
                Add the first one
              </Link>
            </>
          ) : (
            <>
              {/* The count is the way to the list it counts. The API cannot
                  yet filter that list by account state, so the other three
                  figures stay words rather than links to the wrong list. */}
              <Link href="/homes" className="text-[var(--foreground)] underline">
                {homes.homes} {homes.homes === 1 ? "home" : "homes"}
              </Link>
              {`, ${homes.paying} subscribed, ${homes.onTrial} on trial${homes.suspended > 0 ? `, ${homes.suspended} suspended` : ""}.`}
            </>
          )}
        </p>
      </div>

      <Card>
        <CardTitle>Across every home</CardTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 sm:divide-x sm:divide-[var(--border)] sm:gap-x-0 sm:[&>*]:px-6 sm:[&>*:first-child]:pl-0 sm:[&>*:last-child]:pr-0">
          <Stat label="Cases opened" value={engagement.casesOpened} />
          <Stat
            label="Family links opened"
            value={engagement.familyLinksOpened}
            of={engagement.familyLinksCreated}
          />
          <Stat label="Photographs" value={engagement.photographs} />
          <Stat
            label="Aftercare consented"
            value={engagement.aftercareConsented}
            of={engagement.aftercareEnrolled}
          />
        </div>
      </Card>

      <Delivery delivery={query.data.delivery} />

      <Attention attention={attention} anyHomes={homes.homes > 0} />
    </div>
  );
}

/**
 * Whether the mail is getting out.
 *
 * Everything this product promises after the funeral is an email, and until
 * this card the only place a failure showed up was the server log. One or two
 * plain sentences, and quiet when all is well -- a green tick on every visit
 * trains the eye to skip the card on the day it matters.
 */
function Delivery({ delivery }: { delivery: PlatformOverview["delivery"] }) {
  const problems: string[] = [];

  if (!delivery.mailConfigured) {
    problems.push(
      "Mail is not set up on this deployment. Aftercare check-ins, trial reminders and password resets are being written to the server log instead of sent.",
    );
  }

  if (delivery.aftercareFailedLast30Days > 0) {
    problems.push(
      `${delivery.aftercareFailedLast30Days} aftercare ${delivery.aftercareFailedLast30Days === 1 ? "check-in" : "check-ins"} at ${delivery.homesWithFailures} ${delivery.homesWithFailures === 1 ? "home" : "homes"} could not be sent in the last thirty days, most recently ${formatDateTime(delivery.lastFailureAt)}.`,
    );
  }

  if (!delivery.smsConfigured) {
    problems.push(
      "Text messages are not set up, so directors are handed each family link to send themselves.",
    );
  }

  if (problems.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Mail and text messages are set up, and nothing has failed to send in
        the last thirty days.
      </p>
    );
  }

  return (
    <Card className="border-[var(--notice)]/40 bg-[var(--notice-soft)]">
      <CardTitle>Messages</CardTitle>
      <ul className="flex max-w-prose flex-col gap-2 text-sm leading-relaxed">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * "Worth a look", and the reason it is two lists rather than one.
 *
 * Every home that has recorded no licensure at all produces the same
 * reminder — "nobody is listed here yet" — which on a home's own page is a
 * useful call to action and here, repeated once per home, is a wall of
 * identical paragraphs that buries the one home with an amendment due on
 * Thursday. So a home with a clock actually running gets a card, and the
 * homes nobody has started on get a single line at the bottom.
 *
 * The server still returns the whole picture. Deciding what is worth a
 * person's attention is this screen's job, not the API's.
 */
function Attention({
  attention,
  anyHomes,
}: {
  attention: PlatformOverview["attention"];
  anyHomes: boolean;
}) {
  const running = attention.filter((entry) =>
    entry.reminders.some((reminder) => reminder.key !== "deadline-nobody-listed"),
  );
  const notStarted = attention.filter((entry) =>
    entry.reminders.every((reminder) => reminder.key === "deadline-nobody-listed"),
  );

  return (
    <section>
      <h2 className="font-display text-lg">Worth a look</h2>
      <p className="mb-5 mt-1 max-w-prose text-sm leading-relaxed text-[var(--muted-foreground)]">
        Colorado licensure is due January 1, 2027, and an establishment that
        changes its services has thirty days to file an amended registration.
        These are the homes with something on either clock.
      </p>

      {running.length === 0 && notStarted.length === 0 ? (
        <EmptyState
          title={anyHomes ? "Nothing is due anywhere" : "Nothing to watch yet"}
          detail={
            anyHomes
              ? "Every home with a registration on file is in order, and nobody's license is inside three months. This list fills itself when that changes."
              : "Once there are homes here, anything approaching a DORA date will appear in this list."
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {running.map(({ home, reminders }) => (
            <Card key={home.id}>
              <CardTitle>
                <Link
                  href={`/homes/${home.id}`}
                  className="inline-flex items-center gap-2 no-underline hover:underline"
                >
                  <Swatch color={home.accentColor} name={home.name} />
                  <span className="break-words">{home.name}</span>
                </Link>
              </CardTitle>
              <Reminders
                reminders={reminders}
                emptyDetail="Nothing is due here."
              />
            </Card>
          ))}

          {notStarted.length > 0 && (
            <p className="max-w-prose rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {notStarted.length === 1
                ? "One home has no licensure recorded yet: "
                : `${notStarted.length} homes have no licensure recorded yet: `}
              {notStarted.map(({ home }, index) => (
                <span key={home.id}>
                  {index > 0 && ", "}
                  <Link
                    href={`/homes/${home.id}`}
                    className="text-[var(--foreground)] hover:underline"
                  >
                    {home.name}
                  </Link>
                </span>
              ))}
              . Adding a registration is what starts the reminders for them.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
