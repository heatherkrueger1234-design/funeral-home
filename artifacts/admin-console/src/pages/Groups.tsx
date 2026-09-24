import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { api, describeContract, type AdminGroup } from "@/lib/api";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
} from "@/components/ui";

/**
 * Groups: one contract, many locations.
 *
 * A group is agreed on a call between us and somebody who owns several
 * funeral homes, so it is set up here and nowhere else. The page is small on
 * purpose -- a name to create one, a list to find one -- because what matters
 * about a group (its locations, its contract) is on the group's own page.
 */
export function Groups() {
  const [creating, setCreating] = useState(false);

  const query = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<AdminGroup[]>("/admin/groups"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl leading-tight">Groups</h1>
          <p className="mt-1 max-w-prose text-[var(--muted-foreground)]">
            Owners of several homes, on one contract and one invoice. Each
            location still works exactly as an independent home does.
          </p>
        </div>
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Set up a group
          </Button>
        )}
      </div>

      {creating && <CreateGroup onDone={() => setCreating(false)} />}

      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title="No groups yet"
          detail="Most homes are independent and never need one. When somebody who owns several homes agrees a single contract, set up their group here, then move each location into it from the home's own page."
          action={
            !creating && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Set up the first group
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--elevation-1)]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border-strong)] bg-[var(--sunken)]">
                <th scope="col" className="eyebrow px-4 py-2.5">Group</th>
                <th scope="col" className="eyebrow px-4 py-2.5">Contract</th>
                <th scope="col" className="eyebrow px-4 py-2.5 text-right">
                  Locations
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((group) => (
                <tr
                  key={group.id}
                  className="border-b border-[var(--border)] transition-colors duration-150 last:border-0 hover:bg-[var(--sunken)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/groups/${group.id}`}
                      className="font-semibold break-words no-underline hover:underline"
                    >
                      {group.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm">{describeContract(group)}</td>
                  <td className="tabular px-4 py-3 text-right">
                    {group.locations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateGroup({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => api.post<AdminGroup>("/admin/groups", { name: name.trim() }),
    onSuccess: (group) => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      // Straight to the new group: the next thing anybody does with an
      // empty group is find out how to put its locations in it.
      navigate(`/groups/${group.id}`);
    },
  });

  return (
    <Card>
      <h2 className="font-display text-lg">Set up a group</h2>
      <form
        className="mt-4 flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="max-w-md">
          <Field
            label="Name of the group"
            required
            autoFocus
            maxLength={160}
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="As it appears on their contract. It starts on the same trial a single home gets, until its subscription begins."
            problem={create.error instanceof Error ? create.error.message : undefined}
          />
        </div>
        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "Setting it up…" : "Set up the group"}
          </Button>
          <Button type="button" variant="plain" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
