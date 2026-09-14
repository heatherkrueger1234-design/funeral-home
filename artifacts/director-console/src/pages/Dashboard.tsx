import { Link } from "wouter";
import {
  useGetHomeDashboard,
  getGetHomeDashboardQueryKey,
} from "@workspace/api-client-react";
import type {
  DashboardDeadline,
  DashboardService,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { SetupChecklist, TrialBanner } from "@/components/SetupChecklist";
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Inbox,
  Loader2,
  MessageSquare,
  Store,
} from "lucide-react";

/**
 * The master page: what this home needs to answer today, and nothing else.
 *
 * Everything on this screen is already reachable a page at a time, which is
 * the problem it exists for. A director with four funerals this week does not
 * experience four cases — they experience a Tuesday, and until now nothing
 * told them that a family answered at midnight, that a service is tomorrow,
 * and that two steps went past due while they were at a graveside.
 *
 * The ordering is the argument. Things somebody else is waiting on come
 * first: an unanswered family, a request from a stranger, a step that has
 * already slipped. What the home is doing next week comes after that. Nothing
 * here is a metric — there is no chart, no trend and no count of cases
 * handled this quarter, because a funeral home is not a funnel and a
 * dashboard that treats it like one is one a director stops opening.
 */

/** Dates in a funeral home are always read alongside the day of the week. */
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const asDate = (value: string | Date) =>
  value instanceof Date ? value : new Date(value);

function whenLabel(value: string | Date): string {
  const date = asDate(value);
  return `${dayFormat.format(date)}, ${timeFormat.format(date)}`;
}

/** "3 days ago", "in 2 days". Plain words, because that is how it is said. */
function relative(value: string | Date): string {
  const ms = asDate(value).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);

  if (Math.abs(ms) < 3_600_000) return "within the hour";
  if (days === 0) return ms < 0 ? "earlier today" : "later today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  return days < 0 ? `${-days} days ago` : `in ${days} days`;
}

export default function Dashboard() {
  const dashboard = useGetHomeDashboard({
    query: {
      queryKey: getGetHomeDashboardQueryKey(),
      // A console left open all day should reflect the morning's post without
      // anybody pressing anything, and should not chatter.
      refetchInterval: 120_000,
    },
  });

  if (dashboard.isPending) {
    return (
      <div className="py-16 grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!dashboard.data) return null;

  const data = dashboard.data;
  const nothingWaiting =
    data.casesWaitingOnReply === 0 &&
    data.pendingRequests === 0 &&
    data.overdue.length === 0 &&
    data.offersAwaitingChoice === 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl">{data.homeName}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {data.openCases === 0
            ? "No open cases."
            : `${data.openCases} open ${data.openCases === 1 ? "case" : "cases"}.`}
        </p>
      </header>

      {/*
        Both of these decide for themselves whether they belong on screen, and
        the trial banner in particular is deliberately silent until the last
        week — a director working their first case does not need a clock on it.
      */}
      <TrialBanner />
      <SetupChecklist />

      {/*
        People waiting on this home. First, and visually separate, because
        everything below is work the home controls the pace of and everything
        here is somebody sitting by a telephone.
      */}
      <section className="grid gap-3 sm:grid-cols-3">
        <WaitingTile
          icon={<MessageSquare className="size-4" />}
          count={data.casesWaitingOnReply}
          label={
            data.casesWaitingOnReply === 1
              ? "family is waiting on a reply"
              : "families are waiting on a reply"
          }
          detail={
            data.unansweredMessages > data.casesWaitingOnReply
              ? `${data.unansweredMessages} messages in all`
              : undefined
          }
          href="/inbox"
        />
        <WaitingTile
          icon={<Inbox className="size-4" />}
          count={data.pendingRequests}
          label={
            data.pendingRequests === 1
              ? "request from your page"
              : "requests from your page"
          }
          href="/requests"
        />
        <WaitingTile
          icon={<CalendarClock className="size-4" />}
          count={data.offersAwaitingChoice}
          label={
            data.offersAwaitingChoice === 1
              ? "family has times to choose from"
              : "families have times to choose from"
          }
          detail="Waiting on them, not on you"
          href="/cases"
        />
      </section>

      {nothingWaiting && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm
                      text-muted-foreground">
          Nobody is waiting on you right now.
        </p>
      )}

      {data.overdue.length > 0 && (
        <DeadlineSection
          title="Past due"
          tone="urgent"
          description="Nobody has ticked these off, and the date has gone."
          rows={data.overdue}
        />
      )}

      <section>
        <h2 className="font-medium mb-3">This week</h2>
        {data.servicesThisWeek.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border
                        border-dashed p-6 text-center">
            No services in the next seven days.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.servicesThisWeek.map((row: DashboardService) => (
              <li key={row.caseId}>
                <Link
                  href={`/cases/${row.caseId}`}
                  className="flex items-baseline justify-between gap-4 rounded-lg
                             border p-3 hover:bg-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block font-medium truncate">
                      {row.decedentName}
                    </span>
                    {row.serviceLocation && (
                      <span className="block text-sm text-muted-foreground truncate">
                        {row.serviceLocation}
                      </span>
                    )}
                  </span>
                  <span className="text-sm whitespace-nowrap text-right">
                    <span className="block">{whenLabel(row.serviceAt)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {relative(row.serviceAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.dueSoon.length > 0 && (
        <DeadlineSection
          title="Due in the next few days"
          tone="normal"
          rows={data.dueSoon}
        />
      )}

      {/*
        The quietest way this product fails.
        Every step of the standard schedule is an offset from the service, so
        a case with no service date has an empty timeline and a family who has
        been told nothing at all about when anything is due. It fails without
        an error, which is why it is on the first screen rather than in a
        report nobody runs.
      */}
      {data.awaitingServiceDate.length > 0 && (
        <section>
          <h2 className="font-medium mb-1 flex items-center gap-2">
            <CalendarX className="size-4 text-muted-foreground" />
            No date yet
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Nothing is due on these, because nothing can be dated until the
            service is. Offer the family a choice of times from the case.
          </p>
          <ul className="space-y-2">
            {data.awaitingServiceDate.map((row) => (
              <li key={row.caseId}>
                <Link
                  href={`/cases/${row.caseId}`}
                  className="flex items-baseline justify-between gap-4 rounded-lg
                             border p-3 hover:bg-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block font-medium truncate">
                      {row.decedentName}
                    </span>
                    {/* Never a word of condolence about somebody alive. */}
                    {row.kind === "pre_need" && (
                      <span className="block text-xs text-muted-foreground">
                        Planning ahead
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    opened {relative(row.openedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-dashed p-4">
        <h2 className="font-medium mb-1 flex items-center gap-2">
          <Store className="size-4 text-muted-foreground" />
          Your own page
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          What families read before they ring you, and the policies you find
          yourself repeating at every kitchen table.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/storefront">Edit your page and policies</Link>
        </Button>
      </section>
    </div>
  );
}

function WaitingTile({
  icon,
  count,
  label,
  detail,
  href,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  detail?: string;
  href: string;
}) {
  const quiet = count === 0;

  return (
    <Link
      href={href}
      className={`rounded-lg border p-4 block transition-colors ${
        quiet ? "opacity-60 hover:opacity-100" : "border-amber-300 bg-amber-50/60"
      } hover:bg-accent/40`}
    >
      <span className="flex items-center gap-2 text-xs uppercase tracking-wide
                       text-muted-foreground mb-1">
        {icon}
      </span>
      <span className="block text-2xl font-display leading-none">{count}</span>
      <span className="block text-sm mt-1">{label}</span>
      {detail && !quiet && (
        <span className="block text-xs text-muted-foreground mt-0.5">
          {detail}
        </span>
      )}
    </Link>
  );
}

function DeadlineSection({
  title,
  description,
  rows,
  tone,
}: {
  title: string;
  description?: string;
  rows: DashboardDeadline[];
  tone: "urgent" | "normal";
}) {
  return (
    <section>
      <h2 className="font-medium mb-1 flex items-center gap-2">
        {tone === "urgent" && (
          <AlertTriangle className="size-4 text-amber-600" />
        )}
        {title}
      </h2>
      {description && (
        <p className="text-sm text-muted-foreground mb-3">{description}</p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/cases/${row.caseId}`}
              className={`flex items-baseline justify-between gap-4 rounded-lg
                          border p-3 hover:bg-accent/40 ${
                            tone === "urgent" ? "border-amber-300" : ""
                          }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{row.title}</span>
                <span className="block text-sm text-muted-foreground truncate">
                  {row.decedentName}
                </span>
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {relative(row.dueAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
