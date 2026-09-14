import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api, type PlatformOverview } from "@/lib/api";
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
        <h1 className="font-display text-2xl">Overview</h1>
        <p className="mt-1 text-[var(--muted-foreground)]">
          {homes.homes === 0
            ? "No homes yet."
            : `${homes.homes} ${homes.homes === 1 ? "home" : "homes"}, ${homes.paying} subscribed, ${homes.onTrial} on trial${homes.suspended > 0 ? `, ${homes.suspended} suspended` : ""}.`}
        </p>
      </div>

      <Card>
        <CardTitle>Across every home</CardTitle>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
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

      <Attention attention={attention} anyHomes={homes.homes > 0} />
    </div>
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
      <p className="mt-1 mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
        Colorado licensure is due 1 January 2027, and an establishment that
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
                  className="inline-flex items-center gap-2 hover:underline"
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
            <p className="max-w-prose text-sm text-[var(--muted-foreground)]">
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
