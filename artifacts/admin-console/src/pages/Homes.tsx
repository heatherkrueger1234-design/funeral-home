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
  HOME_STATUS_LABELS,
  HOME_STATUSES,
  plural,
  type AdminHome,
  type HomeStatus,
} from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Select,
  Swatch,
  usePageTitle,
} from "@/components/ui";

const PAGE_SIZE = 25;

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

  // Keyed on the trimmed, settled text: a trailing space is not a new
  // question, and neither is a word somebody is halfway through typing.
  const term = useSettled(search.trim(), 300);

  const query = useQuery({
    queryKey: ["homes", { term, page, status, includeInternal }],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (term) params.set("search", term);
      if (status) params.set("status", status);
      if (includeInternal) params.set("includeInternal", "true");
      return api.get<HomesPage>(`/admin/homes?${params.toString()}`);
    },
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
    </div>
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
            <th scope="col" className="eyebrow px-4 py-2.5">Home</th>
            <th scope="col" className="eyebrow px-4 py-2.5">Account</th>
            <th scope="col" className="eyebrow px-4 py-2.5">Trial ends</th>
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">Cases</th>
            <th scope="col" className="eyebrow hidden px-4 py-2.5 text-right md:table-cell">Links opened</th>
            <th scope="col" className="eyebrow hidden px-4 py-2.5 text-right md:table-cell">Photographs</th>
            <th scope="col" className="eyebrow hidden px-4 py-2.5 text-right md:table-cell">Joined</th>
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
                {formatDate(home.createdAt)}
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
  const first = page * PAGE_SIZE + 1;
  const last = page * PAGE_SIZE + showing;

  if (total <= PAGE_SIZE) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="tabular text-sm text-[var(--muted-foreground)]">
        {first}–{last} of {total}
      </p>
      <div className="flex gap-2">
        <Button disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button disabled={last >= total} onClick={() => onPage(page + 1)}>
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
  const [form, setForm] = useState({
    name: "",
    ownerEmail: "",
    city: "",
    region: "CO",
    phone: "",
    timezone: "America/Denver",
  });
  const [created, setCreated] = useState<{
    id: number;
    name: string;
    invited: boolean;
    mailSent: boolean;
  } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<AdminHome & { mailSent: boolean }>("/admin/homes", {
        name: form.name.trim(),
        ...(form.ownerEmail.trim()
          ? { ownerEmail: form.ownerEmail.trim() }
          : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.region.trim() ? { region: form.region.trim() } : {}),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        timezone: form.timezone,
      }),
    onSuccess: (home) => {
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
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
      <form
        className="mt-4 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Name of the home"
            required
            maxLength={160}
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            hint="As it appears on their sign."
          />
          <Field
            label="Owner's email address"
            type="email"
            maxLength={254}
            value={form.ownerEmail}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                ownerEmail: event.target.value,
              }))
            }
            hint="Optional. They get an invitation and set their own password."
            problem={emailProblem}
          />
          <Field
            label="Town"
            maxLength={120}
            value={form.city}
            onChange={(event) =>
              setForm((current) => ({ ...current, city: event.target.value }))
            }
          />
          <Field
            label="State"
            maxLength={120}
            value={form.region}
            onChange={(event) =>
              setForm((current) => ({ ...current, region: event.target.value }))
            }
          />
          <Field
            label="Telephone"
            type="tel"
            autoComplete="off"
            value={form.phone}
            onChange={(event) =>
              setForm((current) => ({ ...current, phone: event.target.value }))
            }
            hint="Optional. The home's main number."
          />
          <Select
            label="Time zone"
            value={form.timezone}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
          >
            {TIMEZONES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

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
