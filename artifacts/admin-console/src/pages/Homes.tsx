import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "wouter";
import {
  api,
  describeAccount,
  formatDate,
  formatDay,
  formatMoney,
  HOME_STATUS_LABELS,
  HOME_STATUSES,
  plural,
  toCents,
  toDollars,
  type AdminHome,
  type FinancialHome,
  type Financials as FinancialsData,
  type HomeStatus,
  type RunningCost,
  type PlatformPlan,
} from "@/lib/api";
import { amountForPlan, HOME_SORTS, homesQuery, pageSpan } from "@/lib/homes";
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Select,
  Swatch,
  usePageTitle,
} from "@/components/ui";

type HomesPage = { total: number; homes: AdminHome[] };

/**
 * A value that only changes once it has stopped changing for `delay` ms.
 *
 * The search box is the reason. Every keystroke used to be a request, and
 * every request to the homes list is an audited read, so typing "Horan" wrote
 * five lines to the access log -- "searched for H", "searched for Ho" -- on
 * the page a customer is shown to prove how little we look.
 */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * The customer list.
 *
 * A table, because forty homes with six numbers each is what a table is for,
 * and this is an internal screen where density is a kindness rather than a
 * crowd. It pages at twenty-five rather than scrolling forever: the answer to
 * "too much data" is a page and a search box, not a longer page.
 */
export function Homes() {
  usePageTitle("Homes");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<HomeStatus | "">("");
  const [includeInternal, setIncludeInternal] = useState(false);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  /**
   * Server-side sort, because a sorted first page of an unsorted list is a
   * lie about the other pages. The value packs the column and the direction
   * together so the select stays one control.
   */
  const [sort, setSort] = useState<string>("");

  // Keyed on the trimmed, settled text: a trailing space is not a new
  // question, and neither is a word somebody is halfway through typing.
  const term = useSettled(search.trim(), 300);

  const query = useQuery({
    queryKey: ["homes", { term, page, status, includeInternal, sort }],
    queryFn: () =>
      api.get<HomesPage>(
        `/admin/homes?${homesQuery({ term, page, status, includeInternal, sort })}`,
      ),
    // The last answer stays on screen while the next one loads, rather than
    // the table collapsing to a skeleton on every search and every page.
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(term || status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Homes</h1>
          <p className="mt-1 text-[var(--muted-foreground)]">
            {query.data
              ? term
                ? `${plural(query.data.total, "home")} matching “${term}”`
                : plural(query.data.total, "home")
              : " "}
          </p>
        </div>
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add a home
          </Button>
        )}
      </div>

      {creating && (
        <CreateHome
          onDone={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setPage(0);
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="w-full max-w-sm">
          <Field
            label="Find a home"
            type="search"
            value={search}
            placeholder="Name, web address or a staff email"
            hint="A staff email finds its home only when typed in full."
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="w-56">
          <Select
            label="Sort the list"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            {HOME_SORTS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-56">
          <Select
            label="Account"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as HomeStatus | "");
              setPage(0);
            }}
          >
            <option value="">Any</option>
            {HOME_STATUSES.map((value) => (
              <option key={value} value={value}>
                {HOME_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        {/*
          Our own homes are left out by default, because this is the list of
          customers. Without a way back to them, a home marked ours by mistake
          could only be found by typing its number into the address bar.
        */}
        <label className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            className="size-4 accent-[var(--accent)]"
            checked={includeInternal}
            onChange={(event) => {
              setIncludeInternal(event.target.checked);
              setPage(0);
            }}
          />
          Show our own homes
        </label>
      </div>

      {query.isPending ? (
        <LoadingRows rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.homes.length === 0 ? (
        <EmptyState
          title={filtered ? "No home matches that" : "No homes yet"}
          detail={
            filtered
              ? "Nothing here matches what you asked for. Clearing the search and the account filter brings the whole list back."
              : "Adding a home creates it with the standard schedule and the default office hours already in place, so whoever signs in first is not starting from an empty screen."
          }
          action={
            filtered ? (
              <Button
                onClick={() => {
                  setSearch("");
                  setStatus("");
                }}
              >
                Clear the filters
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add the first home
              </Button>
            )
          }
        />
      ) : (
        <>
          <HomesTable homes={query.data.homes} />
          <Pager
            page={page}
            total={query.data.total}
            onPage={setPage}
            showing={query.data.homes.length}
          />
        </>
      )}

      <Financials />
    </div>
  );
}

/**
 * The money, at a glance. Phase 1 §4c: what the homes agreed to pay, what
 * running the platform costs, and the difference — the whole financial
 * picture in under 30 seconds.
 */
function Financials() {
  const query = useQuery({
    queryKey: ["financials"],
    queryFn: () => api.get<FinancialsData>("/admin/financials"),
  });

  return (
    <section aria-label="Financials" className="mt-4 flex flex-col gap-6">
      <div>
        <h2 className="font-display text-xl">Financials</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          What the homes pay us, what the platform costs, and the difference.
        </p>
      </div>

      {query.isPending ? (
        <LoadingRows rows={4} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="eyebrow">Monthly total</p>
              <p className="tabular mt-1 font-display text-2xl">
                {formatMoney(query.data.monthlyTotalCents)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Across {plural(query.data.payingHomes, "paying home")}. Trials
                are not revenue yet; canceled and suspended homes are not
                revenue any more. Annual plans count as a twelfth of their
                yearly amount — the per-home table keeps what was actually
                charged.
              </p>
            </Card>
            <Card>
              <p className="eyebrow">Running costs</p>
              <p className="tabular mt-1 font-display text-2xl">
                {formatMoney(query.data.runningCostsCents)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                What the platform itself costs each month.
              </p>
            </Card>
            <Card>
              <p className="eyebrow">Profit</p>
              <p
                className={`tabular mt-1 font-display text-2xl ${
                  query.data.profitCents < 0 ? "text-[var(--notice)]" : ""
                }`}
              >
                {formatMoney(query.data.profitCents)}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Revenue minus running costs.
              </p>
            </Card>
          </div>

          <FinancialsTable homes={query.data.homes} />
          <RunningCosts
            costs={query.data.runningCosts}
            onChanged={() => void query.refetch()}
          />
        </>
      )}
    </section>
  );
}

function FinancialsTable({ homes }: { homes: FinancialHome[] }) {
  if (homes.length === 0) {
    return (
      <EmptyState
        title="No homes to show"
        detail="Add a home above and its commercial details will appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevation-1)]">
      <table className="w-full text-left md:min-w-[64rem]">
        <thead>
          <tr className="border-b border-[var(--border-strong)] bg-[var(--sunken)]">
            <th scope="col" className="eyebrow px-4 py-2.5">
              Home
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Contact
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Status
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Plan
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">
              Amount
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Next due
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Discount
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Heard via
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {homes.map((home) => (
            <tr
              key={home.id}
              className="border-b border-[var(--border)] transition-colors duration-150 last:border-0 hover:bg-[var(--sunken)]"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/homes/${home.id}`}
                  className="font-semibold no-underline hover:underline"
                >
                  {home.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-sm">{home.contactName ?? "—"}</td>
              <td className="px-4 py-3 text-sm">
                {HOME_STATUS_LABELS[home.status as HomeStatus] ?? home.status}
              </td>
              <td className="px-4 py-3 text-sm">{home.plan ?? "—"}</td>
              <td className="tabular px-4 py-3 text-right text-sm font-semibold">
                {formatMoney(home.amountChargedCents)}
                {home.billingPeriod && (
                  <span className="ml-1 font-normal text-[var(--muted-foreground)]">
                    /{home.billingPeriod === "annual" ? "yr" : "mo"}
                  </span>
                )}
              </td>
              <td className="tabular whitespace-nowrap px-4 py-3 text-sm">
                {home.nextDueDate ? formatDate(home.nextDueDate) : "—"}
              </td>
              <td className="max-w-[12rem] break-words px-4 py-3 text-sm">
                {home.discount ?? "—"}
              </td>
              <td className="max-w-[12rem] break-words px-4 py-3 text-sm">
                {home.howHeardAboutUs ?? "—"}
              </td>
              <td className="max-w-[16rem] break-words px-4 py-3 text-sm text-[var(--muted-foreground)]">
                {home.notes ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the platform itself costs each month: hosting, domains, the Prodigi
 * print account, anything else with a recurring bill.
 */
function RunningCosts({
  costs,
  onChanged,
}: {
  costs: RunningCost[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        monthlyAmountCents: toCents(amount),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      return editingId === null
        ? api.post<RunningCost>("/admin/running-costs", body)
        : api.put<RunningCost>(`/admin/running-costs/${editingId}`, body);
    },
    onSuccess: () => {
      setAdding(false);
      setEditingId(null);
      setName("");
      setAmount("");
      setNotes("");
      onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/running-costs/${id}`),
    onSuccess: () => onChanged(),
  });

  const problem = save.error instanceof Error ? save.error.message : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg">Running costs</h3>
        {!adding && (
          <Button
            variant="plain"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setName("");
              setAmount("");
              setNotes("");
            }}
          >
            Add a cost
          </Button>
        )}
      </div>

      {costs.length === 0 && !adding ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Nothing recorded. Add hosting, domains, the Prodigi fees — whatever
          the platform costs you each month.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {costs.map((cost) => (
            <li
              key={cost.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2"
            >
              <div>
                <span className="font-semibold">{cost.name}</span>
                {cost.notes && (
                  <span className="ml-2 text-sm text-[var(--muted-foreground)]">
                    {cost.notes}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular text-sm font-semibold">
                  {formatMoney(cost.monthlyAmountCents)}/mo
                </span>
                <Button
                  variant="plain"
                  onClick={() => {
                    setAdding(true);
                    setEditingId(cost.id);
                    setName(cost.name);
                    setAmount(toDollars(cost.monthlyAmountCents));
                    setNotes(cost.notes ?? "");
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="plain"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove “${cost.name}”? This only stops counting it, nothing else changes.`,
                      )
                    ) {
                      remove.mutate(cost.id);
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field
            label="Name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="“Hosting”, “Domains”, “Prodigi fees”…"
          />
          <Field
            label="Monthly amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            hint="Dollars per month."
          />
          <Field
            label="Notes"
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          {problem && (
            <p
              role="alert"
              className="rounded-md bg-[var(--notice-soft)] p-3 text-sm text-[var(--notice)] sm:col-span-3"
            >
              {problem}
            </p>
          )}
          <div className="flex gap-3 sm:col-span-3">
            <Button
              type="submit"
              variant="primary"
              disabled={save.isPending || !name.trim() || !amount.trim()}
            >
              {save.isPending
                ? "Saving…"
                : editingId === null
                  ? "Add the cost"
                  : "Save the cost"}
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function HomesTable({ homes }: { homes: AdminHome[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevation-1)]">
      {/*
        On a phone the three usage columns step aside: the name and the
        account are what anyone looks this list up for, and the rest is on
        the home's own page one tap away.
      */}
      <table className="w-full text-left md:min-w-[58rem]">
        {/*
          The header is a rule and a set of small caps, the way a printed
          table rules its header — not a grey band. The counts are right-aligned
          so the digits stack; the words stay left. A column of numbers that
          are not aligned is a column nobody can scan.
        */}
        <thead>
          <tr className="border-b border-[var(--border-strong)] bg-[var(--sunken)]">
            <th scope="col" className="eyebrow px-4 py-2.5">
              Home
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Account
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5">
              Trial ends
            </th>
            {/*
              The commercial columns — the point of the Phase 1 §4b customer
              record is that Heather can read her book of business at a
              glance, not by opening every home. They sort server-side.
            */}
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 md:table-cell"
            >
              Plan
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 text-right md:table-cell"
            >
              Amount
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 md:table-cell"
            >
              Next due
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 md:table-cell"
            >
              Discount
            </th>
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">
              Cases
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 text-right md:table-cell"
            >
              Links opened
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 text-right md:table-cell"
            >
              Photographs
            </th>
            <th
              scope="col"
              className="eyebrow hidden px-4 py-2.5 text-right md:table-cell"
            >
              Joined
            </th>
          </tr>
        </thead>
        <tbody>
          {homes.map((home) => (
            <tr
              key={home.id}
              className="border-b border-[var(--border)] transition-colors duration-150 last:border-0 hover:bg-[var(--sunken)]"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/homes/${home.id}`}
                  className="inline-flex items-center gap-2 font-semibold no-underline hover:underline"
                >
                  <Swatch color={home.accentColor} name={home.name} />
                  {/* Long names wrap rather than blowing the column out. */}
                  <span className="max-w-[18rem] break-words">{home.name}</span>
                </Link>
                {home.internalAccount && (
                  <span className="ml-2 rounded-sm bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--accent-deep)]">
                    Ours
                  </span>
                )}
                {(home.city || home.region) && (
                  <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                    {[home.city, home.region].filter(Boolean).join(", ")}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-sm">
                {describeAccount(home)}
                {home.suspendedReason && (
                  <p className="text-[var(--muted-foreground)]">
                    {home.suspendedReason}
                  </p>
                )}
              </td>
              <td className="tabular whitespace-nowrap px-4 py-3 text-sm">
                {home.subscriptionStatus === "trial" ? (
                  formatDay(home.trialEndsAt)
                ) : (
                  <span className="text-[var(--muted-foreground)]">—</span>
                )}
              </td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-sm md:table-cell">
                {home.subscriptionPlan ?? (
                  <span className="text-[var(--muted-foreground)]">—</span>
                )}
              </td>
              <td className="tabular hidden whitespace-nowrap px-4 py-3 text-right text-sm md:table-cell">
                {formatMoney(home.billingAmountCents)}
              </td>
              <td className="tabular hidden whitespace-nowrap px-4 py-3 text-sm md:table-cell">
                {home.subscriptionDueDate ? (
                  formatDate(home.subscriptionDueDate)
                ) : (
                  <span className="text-[var(--muted-foreground)]">—</span>
                )}
              </td>
              <td
                className="hidden max-w-[12rem] truncate px-4 py-3 text-sm md:table-cell"
                title={home.discount ?? undefined}
              >
                {home.discount ?? (
                  <span className="text-[var(--muted-foreground)]">—</span>
                )}
              </td>
              <td className="tabular px-4 py-3 text-right">
                {home.engagement.casesOpened}
              </td>
              <td className="tabular hidden px-4 py-3 text-right md:table-cell">
                {home.engagement.familyLinksOpened}
                <span className="text-[var(--muted-foreground)]">
                  {" "}
                  of {home.engagement.familyLinksCreated}
                </span>
              </td>
              <td className="tabular hidden px-4 py-3 text-right md:table-cell">
                {home.engagement.photographs}
              </td>
              <td className="tabular hidden whitespace-nowrap px-4 py-3 text-right text-sm text-[var(--muted-foreground)] md:table-cell">
                {formatDay(home.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  total,
  showing,
  onPage,
}: {
  page: number;
  total: number;
  showing: number;
  onPage: (page: number) => void;
}) {
  const span = pageSpan(page, total, showing);

  if (!span) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="tabular text-sm text-[var(--muted-foreground)]">
        {span.first}–{span.last} of {total}
      </p>
      <div className="flex gap-2">
        <Button disabled={!span.previous} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={!span.next} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * The zones a Colorado customer and its neighbours actually use. A select
 * rather than free text, because the server refuses a zone it does not know
 * and "Mountain" is not one.
 */
const TIMEZONES = [
  ["America/Denver", "Mountain (Denver)"],
  ["America/Phoenix", "Mountain, no daylight saving (Phoenix)"],
  ["America/Chicago", "Central (Chicago)"],
  ["America/New_York", "Eastern (New York)"],
  ["America/Los_Angeles", "Pacific (Los Angeles)"],
  ["America/Anchorage", "Alaska (Anchorage)"],
  ["Pacific/Honolulu", "Hawaii (Honolulu)"],
] as const;

/**
 * Opening a home from a blank template.
 *
 * The owner's email is optional and it is the most useful field on the form:
 * with it, the home is reachable the moment this returns, because an
 * invitation goes to the owner's inbox. Without it, the home exists and
 * nobody can sign in to it yet -- a real answer when the paperwork is ahead
 * of the people -- and the home's own page has the button that invites an
 * owner later.
 *
 * The invitation link itself never comes back here. It used to, "in case the
 * email lands in spam", but whoever holds that link chooses the owner's
 * password, and a console that could do that for every home it created is
 * one that could sign in as any of them.
 */
function CreateHome({
  onDone,
  onCreated,
}: {
  onDone: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const plansQuery = useQuery({
    queryKey: ["plans"],
    queryFn: () => api.get<{ plans: PlatformPlan[] }>("/admin/plans"),
  });
  const plans = plansQuery.data?.plans ?? [];

  const [form, setForm] = useState({
    name: "",
    contactName: "",
    ownerEmail: "",
    addressLine1: "",
    city: "",
    region: "CO",
    postalCode: "",
    phone: "",
    timezone: "America/Denver",
    planName: "",
    billingPeriod: "monthly",
    billingAmount: "",
    billingStartDate: "",
    subscriptionDueDate: "",
    discount: "",
    howHeardAboutUs: "",
    adminNotes: "",
  });
  const [created, setCreated] = useState<{
    id: number;
    name: string;
    invited: boolean;
    mailSent: boolean;
  } | null>(null);

  const set =
    (key: keyof typeof form) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const pickPlan = (planName: string, period: string) => {
    setForm((current) => ({
      ...current,
      planName,
      billingPeriod: period,
      billingAmount: amountForPlan(plans, current, planName, period),
    }));
  };
  const create = useMutation({
    mutationFn: () => {
      const amount = form.billingAmount.trim();
      const commercial = form.planName.trim() !== "" || amount !== "";
      return api.post<AdminHome & { mailSent: boolean }>("/admin/homes", {
        name: form.name.trim(),
        ...(form.contactName.trim()
          ? { contactName: form.contactName.trim() }
          : {}),
        ...(form.ownerEmail.trim()
          ? { ownerEmail: form.ownerEmail.trim() }
          : {}),
        ...(form.addressLine1.trim()
          ? { addressLine1: form.addressLine1.trim() }
          : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.region.trim() ? { region: form.region.trim() } : {}),
        ...(form.postalCode.trim()
          ? { postalCode: form.postalCode.trim() }
          : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        timezone: form.timezone,
        ...(form.planName.trim()
          ? { subscriptionPlan: form.planName.trim() }
          : {}),
        ...(commercial ? { billingPeriod: form.billingPeriod } : {}),
        ...(amount ? { billingAmountCents: toCents(amount) } : {}),
        ...(form.billingStartDate
          ? { billingStartDate: form.billingStartDate }
          : {}),
        ...(form.subscriptionDueDate
          ? { subscriptionDueDate: form.subscriptionDueDate }
          : {}),
        ...(form.discount.trim() ? { discount: form.discount.trim() } : {}),
        ...(form.howHeardAboutUs.trim()
          ? { howHeardAboutUs: form.howHeardAboutUs.trim() }
          : {}),
        ...(form.adminNotes.trim()
          ? { adminNotes: form.adminNotes.trim() }
          : {}),
      });
    },
    onSuccess: (home) => {
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["financials"] });
      setCreated({
        id: home.id,
        name: home.name,
        invited: Boolean(form.ownerEmail.trim()),
        mailSent: home.mailSent,
      });
    },
  });

  // The server's only complaint about the address is that it is taken; any
  // other refusal is about the form as a whole, and belongs at the bottom of
  // it rather than under a field that may have been left empty.
  const problem = create.error instanceof Error ? create.error.message : null;
  const emailProblem = problem && /email/i.test(problem) ? problem : undefined;
  const formProblem = problem && !emailProblem ? problem : null;

  if (created) {
    return (
      <Card>
        <h2 className="font-display text-lg">{created.name} is ready</h2>
        <p className="mt-2 max-w-prose text-sm">
          It has the standard schedule and the default office hours already in
          place.
        </p>
        {created.invited ? (
          created.mailSent ? (
            <p role="status" className="mt-2 max-w-prose text-sm">
              An invitation is on its way to the owner. They choose their own
              password from it — nobody here ever sees it. If it does not
              arrive, the home's page can send it again.
            </p>
          ) : (
            <p
              role="alert"
              className="mt-2 max-w-prose rounded-md bg-[var(--notice-soft)] p-3 text-sm"
            >
              The owner's account exists, but no invitation was sent: mail is
              not set up on this deployment, or the mail server would not take
              it. Once mail is working, open the home and use "Resend the
              invitation" next to the owner's name.
            </p>
          )
        ) : (
          <p className="mt-2 max-w-prose text-sm">
            Nobody can sign in to it yet. When you have the owner's address,
            invite them from the home's page.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href={`/homes/${created.id}`}
            className="inline-flex min-h-11 items-center rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-4 text-sm font-semibold no-underline shadow-[var(--elevation-1)] hover:border-[var(--accent)]"
          >
            Open {created.name}
          </Link>
          <Button
            variant="primary"
            onClick={() => {
              setCreated(null);
              onCreated();
            }}
          >
            Done
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="font-display text-lg">Add a home</h2>
      <p className="mt-1 max-w-prose text-sm text-[var(--muted-foreground)]">
        Everything you know about them, captured once. Saving creates their
        account and invites the owner — the home's side is already filled in
        with what you typed here.
      </p>
      <form
        className="mt-4 flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <fieldset>
          <legend className="eyebrow mb-3">The home</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Name of the home"
              required
              maxLength={160}
              value={form.name}
              onChange={set("name")}
              hint="As it appears on their sign."
            />
            <Field
              label="Contact person"
              maxLength={160}
              value={form.contactName}
              onChange={set("contactName")}
              hint="The person you dealt with signing them up."
            />
            <Field
              label="Owner's email address"
              type="email"
              maxLength={254}
              value={form.ownerEmail}
              onChange={set("ownerEmail")}
              hint="Optional. They get an invitation and set their own password."
              problem={emailProblem}
            />
            <Field
              label="Telephone"
              type="tel"
              autoComplete="off"
              value={form.phone}
              onChange={set("phone")}
              hint="Optional. The home's main number."
            />
            <Field
              label="Street address"
              maxLength={200}
              value={form.addressLine1}
              onChange={set("addressLine1")}
            />
            <div className="grid grid-cols-3 gap-5">
              <Field
                label="Town"
                maxLength={120}
                value={form.city}
                onChange={set("city")}
              />
              <Field
                label="State"
                maxLength={120}
                value={form.region}
                onChange={set("region")}
              />
              <Field
                label="ZIP"
                maxLength={20}
                value={form.postalCode}
                onChange={set("postalCode")}
              />
            </div>
            <Select
              label="Time zone"
              value={form.timezone}
              onChange={set("timezone")}
            >
              {TIMEZONES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="eyebrow mb-3">
            The commercial relationship — only we see this
          </legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <Select
              label="Plan"
              value={form.planName}
              onChange={(event) =>
                pickPlan(event.target.value, form.billingPeriod)
              }
              hint={
                plansQuery.isPending
                  ? "Loading the price list…"
                  : plans.length === 0
                    ? "No plans yet — add them on the Plans page and they appear here."
                    : "From the price list. The amount fills in below; change it if the deal differs."
              }
            >
              <option value="">No plan — amount by hand</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.name}>
                  {plan.name}
                </option>
              ))}
            </Select>
            <Select
              label="Billing period"
              value={form.billingPeriod}
              onChange={(event) => pickPlan(form.planName, event.target.value)}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </Select>
            <Field
              label="Amount charged"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.billingAmount}
              onChange={set("billingAmount")}
              hint={
                form.billingPeriod === "annual"
                  ? "Dollars per year. The monthly total counts a twelfth of this."
                  : "Dollars per month."
              }
            />
            <Field
              label="Billing started"
              type="date"
              value={form.billingStartDate}
              onChange={set("billingStartDate")}
            />
            <Field
              label="Next due date"
              type="date"
              value={form.subscriptionDueDate}
              onChange={set("subscriptionDueDate")}
            />
            <Field
              label="Discount"
              maxLength={200}
              value={form.discount}
              onChange={set("discount")}
              hint="In your own words — “20% off the first year”, “$50/mo loyalty”."
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="how-heard" className="text-sm font-semibold">
                How they heard about us
              </label>
              <input
                id="how-heard"
                list="how-heard-options"
                maxLength={200}
                value={form.howHeardAboutUs}
                onChange={set("howHeardAboutUs")}
                className="min-h-11 rounded-md border border-[var(--border-strong)] bg-white px-3 text-base shadow-[inset_0_1px_2px_rgb(40_34_24/0.04)]"
              />
              <datalist id="how-heard-options">
                <option value="Referral from another home" />
                <option value="Google search" />
                <option value="Conference" />
                <option value="Cold outreach" />
                <option value="Word of mouth" />
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="admin-notes" className="text-sm font-semibold">
                Special notes
              </label>
              <textarea
                id="admin-notes"
                rows={3}
                maxLength={4000}
                value={form.adminNotes}
                onChange={set("adminNotes")}
                className="rounded-md border border-[var(--border-strong)] bg-white px-3 py-2.5 text-base shadow-[inset_0_1px_2px_rgb(40_34_24/0.04)]"
              />
              <p className="text-sm text-[var(--muted-foreground)]">
                Anything you need to know at a glance about this customer.
              </p>
            </div>
          </div>
        </fieldset>

        {formProblem && (
          <p
            role="alert"
            className="rounded-md bg-[var(--notice-soft)] p-3 text-sm text-[var(--notice)]"
          >
            {formProblem}
          </p>
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || !form.name.trim()}
          >
            {create.isPending ? "Creating…" : "Create the home"}
          </Button>
          <Button type="button" variant="plain" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
