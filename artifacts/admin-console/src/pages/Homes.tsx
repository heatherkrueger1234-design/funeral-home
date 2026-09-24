import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  api,
  describeAccount,
  formatDate,
  plural,
  type AdminHome,
} from "@/lib/api";
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Swatch,
} from "@/components/ui";

const PAGE_SIZE = 25;

type HomesPage = { total: number; homes: AdminHome[] };

/**
 * The customer list.
 *
 * A table, because forty homes with six numbers each is what a table is for,
 * and this is an internal screen where density is a kindness rather than a
 * crowd. It pages at twenty-five rather than scrolling forever: the answer to
 * "too much data" is a page and a search box, not a longer page.
 */
export function Homes() {
  const [, navigate] = useLocation();
  const urlQuery = new URLSearchParams(useSearch()).get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const [asked, setAsked] = useState(urlQuery.trim());
  const [page, setPage] = useState(0);
  const [ours, setOurs] = useState(false);
  const [creating, setCreating] = useState(false);

  // The address changed from outside the box -- the "Homes" link in the
  // header, or Back -- so the box follows it rather than the other way round.
  useEffect(() => {
    setSearch((current) => (current.trim() === urlQuery ? current : urlQuery));
    setAsked(urlQuery.trim());
  }, [urlQuery]);

  /*
   * Asked a moment after the typing stops, not on every key. Every list
   * request writes a line to the access log -- the log a home's insurer is
   * shown -- and searching "Riverside" one letter at a time wrote nine of
   * them. The search also goes in the address, so coming back from a home
   * lands on the same list rather than the top of all of them.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      setAsked(next);
      navigate(next ? `/homes?q=${encodeURIComponent(next)}` : "/homes", {
        replace: true,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, navigate]);

  const query = useQuery({
    queryKey: ["homes", asked, page, ours],
    queryFn: () =>
      api.get<HomesPage>(
        `/admin/homes?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
          (asked ? `&search=${encodeURIComponent(asked)}` : "") +
          (ours ? "&ours=true" : ""),
      ),
    // The table stays while the next page or search loads, instead of
    // collapsing to skeletons and back on every keystroke.
    placeholderData: keepPreviousData,
  });

  // A page that emptied under us -- the last home on it was marked ours, say
  // -- goes back to the first page rather than claiming there are no homes.
  const emptiedPage =
    page > 0 && query.data !== undefined && query.data.homes.length === 0;
  useEffect(() => {
    if (emptiedPage) setPage(0);
  }, [emptiedPage]);

  const clearSearch = () => {
    setSearch("");
    setPage(0);
  };

  const switchList = (toOurs: boolean) => {
    setOurs(toOurs);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">
            {ours ? "Our own homes" : "Homes"}
          </h1>
          <p className="mt-1 text-[var(--muted-foreground)]">
            {query.data
              ? asked
                ? `${plural(query.data.total, "home")} matching “${asked}”`
                : plural(query.data.total, "home")
              : " "}
          </p>
        </div>
        {!creating && !ours && (
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

      <div className="max-w-sm" role="search">
        <Field
          label="Find a home"
          type="search"
          value={search}
          placeholder="Name, web address or a staff email"
          hint="A staff email finds their home only when it is typed in full."
          maxLength={120}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </div>

      {query.isPending ? (
        <LoadingRows rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.homes.length === 0 ? (
        <EmptyState
          title={
            asked
              ? "No home matches that"
              : ours
                ? "None of ours"
                : "No homes yet"
          }
          detail={
            asked
              ? "Nothing here matches what you typed. Clearing the search brings the whole list back."
              : ours
                ? "A home marked as ours from its own page appears here, out of the customer figures."
                : "Adding a home creates it with the standard schedule and the default office hours already in place, so whoever signs in first is not starting from an empty screen."
          }
          action={
            asked ? (
              <Button onClick={clearSearch}>Clear the search</Button>
            ) : ours ? (
              <Button onClick={() => switchList(false)}>
                Back to the customers
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

      {/* The way to our own homes, and back. Quiet, at the foot, because it
          is visited once a quarter -- but without it a home marked ours
          could only be found again by its address. */}
      <p className="text-sm text-[var(--muted-foreground)]">
        {ours ? (
          <button
            type="button"
            className="min-h-11 underline underline-offset-4 hover:text-[var(--foreground)]"
            onClick={() => switchList(false)}
          >
            Back to the customers
          </button>
        ) : (
          <>
            Demo and staff homes are left out of this list.{" "}
            <button
              type="button"
              className="min-h-11 underline underline-offset-4 hover:text-[var(--foreground)]"
              onClick={() => switchList(true)}
            >
              Show our own homes
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function HomesTable({ homes }: { homes: AdminHome[] }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevation-1)]">
      {/*
        On a phone the three usage columns step aside: the name and the
        account are what anyone looks this list up for, and the rest is on
        the home's own page one tap away.
      */}
      <table className="w-full text-left md:min-w-[52rem]">
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
 * Opening a home from a blank template.
 *
 * The owner's email is optional and it is the most useful field on the form:
 * with it, the home is reachable the moment this returns, because an
 * invitation goes out and the link comes back on screen for the times the
 * email does not arrive. Without it, the home exists and nobody can sign in
 * to it yet — which is a real answer when the paperwork is ahead of the
 * people, and the screen says so rather than pretending otherwise.
 */
function CreateHome({
  onDone,
  onCreated,
}: {
  onDone: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    name: "",
    ownerEmail: "",
    city: "",
    region: "CO",
  });
  const [made, setMade] = useState<{
    id: number;
    name: string;
    link: string | null;
  } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<AdminHome & { inviteLink: string | null }>("/admin/homes", {
        name: form.name.trim(),
        ...(form.ownerEmail.trim()
          ? { ownerEmail: form.ownerEmail.trim() }
          : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.region.trim() ? { region: form.region.trim() } : {}),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      // Always a confirmation, with the way into the new home. It used to
      // close silently when nobody was invited, leaving the new home to be
      // found by searching for it.
      setMade({ id: created.id, name: created.name, link: created.inviteLink });
    },
  });

  if (made) {
    return (
      <Card>
        <h2 className="font-display text-lg">{made.name} is ready</h2>
        <p className="mt-2 max-w-prose text-sm">
          It has the standard schedule and the default office hours already in
          place.{" "}
          {made.link
            ? "An invitation has been emailed to the owner, who sets their own password — nobody here ever types it. Here is the same link, in case the email lands in a spam folder:"
            : "Nobody can sign in to it yet. When you know who the owner is, the home's page is where to go next."}
        </p>
        {made.link && (
          <>
            <p className="mt-3 rounded-md bg-[var(--muted)] p-3 text-sm break-all">
              {made.link}
            </p>
            <p className="mt-2 max-w-prose text-sm text-[var(--muted-foreground)]">
              It works once, for a week. After that, "Email a reset link" on the
              home's page sends them a fresh one.
            </p>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {made.link && <CopyButton text={made.link} label="Copy the link" />}
          <Button
            variant="primary"
            onClick={() => navigate(`/homes/${made.id}`)}
          >
            Open the home
          </Button>
          <Button variant="plain" onClick={onCreated}>
            Done
          </Button>
        </div>
      </Card>
    );
  }

  const problem = create.error instanceof Error ? create.error.message : null;
  const aboutEmail = problem !== null && /email/i.test(problem);

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
            problem={aboutEmail ? (problem ?? undefined) : undefined}
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
        </div>

        {problem && !aboutEmail && (
          <p role="alert" className="max-w-prose text-sm text-[var(--notice)]">
            {problem}
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
