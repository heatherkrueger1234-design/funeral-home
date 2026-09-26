import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBilling,
  useGetHomeDashboard,
  useUpdateDeadline,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  getGetDeadlinesQueryKey,
  getGetHomeDashboardQueryKey,
} from "@workspace/api-client-react";
import type {
  DashboardDeadline,
  DashboardQuoteRequest,
  DashboardService,
} from "@workspace/api-client-react";
import { SetupChecklist, TrialBanner } from "@/components/SetupChecklist";
import { Checkbox } from "@/components/ui/checkbox";
import { Divider, Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
import { cn, formatAtHome, homeDayNumber } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Inbox,
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

const asDate = (value: string | Date) =>
  value instanceof Date ? value : new Date(value);

/**
 * Dates in a funeral home are always read alongside the day of the week, and
 * on the home's clock (`formatAtHome`): the service is at eleven where the
 * chapel is, whatever zone the director reading this has flown to.
 */
function whenLabel(value: string | Date, zone: string | undefined): string {
  return `${formatAtHome(value, zone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })}, ${formatAtHome(value, zone, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * "3 days ago", "in 2 days". Plain words, because that is how it is said.
 *
 * The sign is never dropped. An earlier version answered "within the hour"
 * for anything inside sixty minutes either way, which put "within the hour"
 * against rows in a list headed **Past due** — a director reading that has
 * been told the opposite of the truth about something that has already
 * slipped, on the one screen whose whole job is to be believed.
 *
 * "Today", "tomorrow" and "yesterday" are counted in calendar days rather
 * than in multiples of 86,400,000 milliseconds, which is the same class of
 * mistake one layer down. Rounding the elapsed time meant that a director
 * looking at the console at nine in the morning was told a service at eleven
 * *tonight* was "tomorrow", and that a step which slipped at ten o'clock last
 * night was "yesterday" when they had walked past it on their way in. Both
 * are off by a day in the direction that costs something: a funeral is this
 * evening or it is not, and a diary does not round.
 *
 * The calendar is the home's: "today" is today in the home's town, so a
 * director in London at midnight is not told that tonight's Denver service
 * was yesterday.
 */
function relative(value: string | Date, zone: string | undefined): string {
  const date = asDate(value);
  const ms = date.getTime() - Date.now();
  const past = ms < 0;

  if (Math.abs(ms) < 60_000) return "now";
  if (Math.abs(ms) < 3_600_000) {
    const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
    const unit = `${minutes} min`;
    return past ? `${unit} ago` : `in ${unit}`;
  }

  const days = homeDayNumber(date, zone) - homeDayNumber(new Date(), zone);

  if (days === 0) return past ? "earlier today" : "later today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  return past ? `${-days} days ago` : `in ${days} days`;
}

/** The row shape every list on this screen uses. */
const ROW =
  "flex items-baseline justify-between gap-4 rounded-xl border border-border " +
  "bg-card px-4 py-3 no-underline shadow-[var(--elevation-1)] " +
  "lift transition-gentle hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border))]";

export default function Dashboard() {
  const dashboard = useGetHomeDashboard({
    query: {
      queryKey: getGetHomeDashboardQueryKey(),
      // A console left open all day should reflect the morning's post without
      // anybody pressing anything, and should not chatter.
      refetchInterval: 120_000,
    },
  });

  // The trial banner and the setup checklist sit above the tiles and read
  // billing for themselves. Waiting for it here too (the same cached query,
  // not a second request) means they arrive with the rest of the page instead
  // of landing a beat later and shoving the tiles down under the cursor.
  const billing = useGetBilling();
  const zone = useHomeZone();

  if (dashboard.isPending || billing.isPending) return <Loading rows={4} />;
  if (!dashboard.data) {
    return (
      <LoadFailed what="Today's page" onRetry={() => void dashboard.refetch()} />
    );
  }

  const data = dashboard.data;
  const nothingWaiting =
    data.casesWaitingOnReply === 0 &&
    data.pendingRequests === 0 &&
    data.quoteRequestsWaiting === 0 &&
    data.overdue.length === 0 &&
    data.offersAwaitingChoice === 0;

  return (
    <div className="space-y-8">
      <PageHeader title={data.homeName}>
        {data.openCases === 0
          ? "No open cases."
          : `${data.openCases} open ${data.openCases === 1 ? "case" : "cases"}.`}
      </PageHeader>

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
          icon={<MessageSquare className="size-4" strokeWidth={1.75} />}
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
          icon={<Inbox className="size-4" strokeWidth={1.75} />}
          count={data.pendingRequests}
          label={
            data.pendingRequests === 1
              ? "request from your page"
              : "requests from your page"
          }
          href="/requests"
        />
        <WaitingTile
          icon={<CalendarClock className="size-4" strokeWidth={1.75} />}
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
        <Empty icon={CheckCircle2} title="Nobody is waiting on you">
          No unanswered families, no requests, no prices to chase, and nothing
          past due.
        </Empty>
      )}

      {/*
        A family who pressed "ask the home for a price" was told somebody
        would find out. This is the only place that promise is visible
        across cases, so it sits with the other things people are waiting on
        rather than among the home's own work further down.
      */}
      {data.quoteRequestsWaiting > 0 && (
        <section className="space-y-3">
          <Divider label="Prices families asked for" />
          <p className="max-w-prose text-sm leading-snug text-muted-foreground">
            {data.quoteRequestsWaiting === 1
              ? "One family is waiting to hear what a vendor charges."
              : `${data.quoteRequestsWaiting} requests are waiting on an answer.`}{" "}
            Record it on the case's Service tab and they will see it on their
            page.
          </p>
          <ul className="space-y-2">
            {data.quoteRequests.map((row: DashboardQuoteRequest) => (
              <li key={row.id}>
                <Link href={`/cases/${row.caseId}?tab=service`} className={ROW}>
                  <span className="min-w-0">
                    <span className="block truncate">{row.vendorName}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.decedentName}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    asked {relative(row.requestedAt, zone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.overdue.length > 0 && (
        <DeadlineSection
          label="Past due"
          description="Nobody has ticked these off, and the date has gone. Tick one here if it was done."
          rows={data.overdue}
          urgent
        />
      )}

      <section className="space-y-3">
        <Divider label="This week" />
        {data.servicesThisWeek.length === 0 ? (
          <Empty icon={CalendarDays} title="No services in the next seven days" />
        ) : (
          <ul className="space-y-2">
            {data.servicesThisWeek.map((row: DashboardService) => (
              <li key={row.caseId}>
                <Link href={`/cases/${row.caseId}`} className={ROW}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {row.decedentName}
                    </span>
                    {row.serviceLocation && (
                      <span className="block truncate text-sm text-muted-foreground">
                        {row.serviceLocation}
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-right text-sm">
                    <span className="tabular block">{whenLabel(row.serviceAt, zone)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {relative(row.serviceAt, zone)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.dueSoon.length > 0 && (
        <DeadlineSection label="Due in the next few days" rows={data.dueSoon} />
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
        <section className="space-y-3">
          <Divider label="No date yet" />
          <p className="max-w-prose text-sm leading-snug text-muted-foreground">
            Nothing is due on these, because nothing can be dated until the
            service is. Offer the family a choice of times from the case.
          </p>
          <ul className="space-y-2">
            {data.awaitingServiceDate.map((row) => (
              <li key={row.caseId}>
                {/* Straight to where times are offered, which is what the
                    sentence above tells them to do. */}
                <Link href={`/cases/${row.caseId}?tab=details`} className={ROW}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {row.decedentName}
                    </span>
                    {/* Never a word of condolence about somebody alive. */}
                    {row.kind === "pre_need" && (
                      <span className="block text-xs text-muted-foreground">
                        Planning ahead
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    opened {relative(row.openedAt, zone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        The one standing invitation on this screen, and the only thing here
        that is not about this week.

        It used to borrow the `Empty` component, which was wrong twice over.
        `Empty` means "there is nothing here", and there is: this home has a
        page whether or not they have written anything on it. And `Empty` is
        built to be a calm full-stop at the end of a list, so a promotion
        wearing it took four hundred pixels of centred whitespace at the
        bottom of the master page to say one sentence — the loudest thing on
        the quietest screen in the product. A single ruled row says the same
        thing and then gets out of the way.
      */}
      <Link
        href="/storefront"
        className="lift group mt-2 flex items-center gap-4 rounded-xl border border-border bg-card
                   px-4 py-3.5 no-underline shadow-[var(--elevation-1)] transition-gentle
                   hover:border-[var(--accent)]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-deep)]">
          <Store className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Your own page</span>
          <span className="block text-sm leading-snug text-muted-foreground">
            What families read before they call you, and the policies you find
            yourself repeating at every kitchen table.
          </span>
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-muted-foreground/60 transition-gentle
                     group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
          aria-hidden
        />
      </Link>
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
      className={cn(
        "lift relative block overflow-hidden rounded-xl border p-5 no-underline shadow-[var(--elevation-1)]",
        "transition-gentle",
        quiet
          ? "border-border bg-card text-muted-foreground hover:text-foreground"
          : "border-[var(--accent)]/35 bg-card text-foreground",
      )}
    >
      {/* Somebody is waiting: a rule of the home's colour along the top. */}
      {!quiet && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-[var(--accent)]" />
      )}
      <span className="eyebrow mb-2 flex items-center gap-2">{icon}</span>
      <span
        className={cn(
          "tabular block font-display text-[2rem] leading-none",
          quiet ? "text-foreground/70" : "text-[var(--accent-deep)]",
        )}
      >
        {count}
      </span>
      <span className="mt-1 block text-sm">{label}</span>
      {detail && !quiet && (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {detail}
        </span>
      )}
    </Link>
  );
}

function DeadlineSection({
  label,
  description,
  rows,
  urgent = false,
}: {
  label: string;
  description?: string;
  rows: DashboardDeadline[];
  urgent?: boolean;
}) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();

  /*
   * Ticked off from here. "Past due" is usually something that was done and
   * never marked — the family brought the clothes in on Tuesday — and the
   * way to clear it used to be three screens deep, which is why these lists
   * grew. The row itself still opens the case's timeline.
   */
  const complete = useUpdateDeadline({
    mutation: {
      onSuccess: (_row, { deadlineId }) => {
        const caseId = rows.find((row) => row.id === deadlineId)?.caseId;
        void queryClient.invalidateQueries({ queryKey: getGetHomeDashboardQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
        if (caseId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: getGetDeadlinesQueryKey(caseId) });
          void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
        }
      },
    },
  });

  return (
    <section className="space-y-3">
      <Divider label={label} />
      {description && (
        <p className="max-w-prose text-sm leading-snug text-muted-foreground">
          {description}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3">
            {row.isEvent ? (
              <span className="size-4 shrink-0" aria-hidden />
            ) : (
              <Checkbox
                className="shrink-0"
                aria-label={`Mark "${row.title}" done for ${row.decedentName}`}
                disabled={complete.isPending && complete.variables?.deadlineId === row.id}
                onCheckedChange={(checked) =>
                  checked === true &&
                  complete.mutate({ deadlineId: row.id, data: { completed: true } })
                }
              />
            )}
            <Link
              href={`/cases/${row.caseId}?tab=timeline`}
              className={cn(ROW, "min-w-0 flex-1", urgent && "border-[var(--notice)]/60")}
            >
              <span className="min-w-0">
                <span className="block truncate">{row.title}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {row.decedentName}
                </span>
              </span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {relative(row.dueAt, zone)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
