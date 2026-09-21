import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  api,
  describeAccount,
  formatDate,
  type AdminHome,
} from "@/lib/api";
import {
  Button,
  Card,
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ["homes", search, page],
    queryFn: () =>
      api.get<HomesPage>(
        `/admin/homes?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
          (search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""),
      ),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl">Homes</h1>
          <p className="mt-1 text-[var(--muted-foreground)]">
            {query.data
              ? `${query.data.total} ${query.data.total === 1 ? "home" : "homes"}`
              : " "}
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Add a home
        </Button>
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

      <div className="max-w-sm">
        <Field
          label="Find a home"
          type="search"
          value={search}
          placeholder="Name or web address"
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
          title={search.trim() ? "No home matches that" : "No homes yet"}
          detail={
            search.trim()
              ? "Nothing here matches what you typed. Clearing the search brings the whole list back."
              : "Adding a home creates it with the standard schedule and the default office hours already in place, so whoever signs in first is not starting from an empty screen."
          }
          action={
            search.trim() ? (
              <Button onClick={() => setSearch("")}>Clear the search</Button>
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
      <table className="w-full min-w-[52rem] text-left">
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
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">Links opened</th>
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">Photographs</th>
            <th scope="col" className="eyebrow px-4 py-2.5 text-right">Joined</th>
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
              <td className="tabular px-4 py-3 text-right">
                {home.engagement.familyLinksOpened}
                <span className="text-[var(--muted-foreground)]">
                  {" "}
                  of {home.engagement.familyLinksCreated}
                </span>
              </td>
              <td className="tabular px-4 py-3 text-right">
                {home.engagement.photographs}
              </td>
              <td className="tabular whitespace-nowrap px-4 py-3 text-right text-sm text-[var(--muted-foreground)]">
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
    <div className="flex items-center justify-between gap-4">
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
  const [form, setForm] = useState({
    name: "",
    ownerEmail: "",
    city: "",
    region: "CO",
  });
  const [invite, setInvite] = useState<{ name: string; link: string } | null>(
    null,
  );

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
      if (created.inviteLink) {
        setInvite({ name: created.name, link: created.inviteLink });
      } else {
        onCreated();
      }
    },
  });

  if (invite) {
    return (
      <Card>
        <h2 className="font-display text-lg">{invite.name} is ready</h2>
        <p className="mt-2 max-w-prose text-sm">
          It has the standard schedule and the default office hours already in
          place. An invitation has been emailed to the owner, who sets their own
          password — nobody here ever types it. Here is the same link, in case
          the email lands in a spam folder:
        </p>
        <p className="mt-3 rounded-md bg-[var(--muted)] p-3 text-sm break-all">
          {invite.link}
        </p>
        <div className="mt-4">
          <Button
            variant="primary"
            onClick={() => {
              setInvite(null);
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
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            hint="As it appears on their sign."
          />
          <Field
            label="Owner's email address"
            type="email"
            value={form.ownerEmail}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                ownerEmail: event.target.value,
              }))
            }
            hint="Optional. They get an invitation and set their own password."
            problem={
              create.error instanceof Error ? create.error.message : undefined
            }
          />
          <Field
            label="Town"
            value={form.city}
            onChange={(event) =>
              setForm((current) => ({ ...current, city: event.target.value }))
            }
          />
          <Field
            label="State"
            value={form.region}
            onChange={(event) =>
              setForm((current) => ({ ...current, region: event.target.value }))
            }
          />
        </div>

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
