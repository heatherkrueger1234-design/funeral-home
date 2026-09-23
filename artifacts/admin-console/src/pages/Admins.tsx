import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatDateTime,
  type PlatformAdmin,
} from "@/lib/api";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
} from "@/components/ui";

/**
 * Who can use this console.
 *
 * `replit.md` and `LAUNCH.md` both said access was "granted and revoked from
 * the console's own Admins page", and the API for it was finished and tested,
 * but the page itself had never been built -- so in practice the list was
 * edited with curl or SQL, which is the stale, traceless arrangement the table
 * was introduced to end.
 *
 * Deliberately plain. Adding somebody records an address and nothing else: no
 * account is created and no email is sent, and the person still needs a staff
 * account with that address, *confirmed*, before the console opens for them.
 * Taking somebody off is immediate, on their existing session. You cannot take
 * yourself off; the API refuses, and so does this page, rather than offering a
 * button that only ever fails.
 */
export function Admins() {
  const queryClient = useQueryClient();
  const me = queryClient.getQueryData<{ email: string }>(["platform-access"]);

  const query = useQuery({
    queryKey: ["admins"],
    queryFn: () => api.get<PlatformAdmin[]>("/admin/admins"),
  });

  const active = query.data?.filter((row) => row.revokedAt === null) ?? [];
  const former = query.data?.filter((row) => row.revokedAt !== null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl leading-tight">Who has access</h1>
        <p className="mt-1 max-w-prose text-[var(--muted-foreground)]">
          Everybody here can see every customer's account and the access log.
          Nobody here can see a family, a case or a photograph. Adding or
          removing somebody is itself written to the access log.
        </p>
      </div>

      <GrantAccess />

      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Card>
            <CardTitle>Can sign in now</CardTitle>
            {active.length === 0 ? (
              <EmptyState
                title="Nobody"
                detail="With nobody on the list the console is closed to everyone, which is how it starts."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)]">
                {active.map((row) => (
                  <AdminRow key={row.id} row={row} isMe={row.email === me?.email} />
                ))}
              </ul>
            )}
          </Card>

          {former.length > 0 && (
            <Card>
              <CardTitle>Used to have access</CardTitle>
              <ul className="flex flex-col gap-2 text-sm">
                {former.map((row) => (
                  <li key={row.id} className="break-words">
                    <span className="font-semibold">{row.email}</span>
                    <span className="text-[var(--muted-foreground)]">
                      {" "}
                      — removed {formatDateTime(row.revokedAt)}
                      {row.revokedByEmail ? ` by ${row.revokedByEmail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AdminRow({ row, isMe }: { row: PlatformAdmin; isMe: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: () =>
      api.delete(`/admin/admins/${encodeURIComponent(row.email)}`),
    onSuccess: () => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["admins"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-semibold break-words">
          {row.displayName ? `${row.displayName} · ` : ""}
          {row.email}
          {isMe && (
            <span className="font-normal text-[var(--muted-foreground)]"> (you)</span>
          )}
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          {row.addedByEmail
            ? `Added by ${row.addedByEmail}, ${formatDateTime(row.createdAt)}`
            : `On the list since ${formatDateTime(row.createdAt)}`}
          {row.note ? ` — ${row.note}` : ""}
        </p>
        {revoke.error instanceof Error && (
          <p role="alert" className="mt-1 text-sm text-[var(--notice)]">
            {revoke.error.message}
          </p>
        )}
      </div>

      {isMe ? null : confirming ? (
        <div className="flex gap-2">
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            {revoke.isPending ? "Removing…" : `Remove ${row.email}`}
          </Button>
          <Button variant="plain" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>Remove access</Button>
      )}
    </li>
  );
}

function GrantAccess() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", displayName: "", note: "" });
  const [added, setAdded] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      api.post<PlatformAdmin>("/admin/admins", {
        email: form.email.trim(),
        ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      }),
    onSuccess: (row) => {
      setAdded(row.email);
      setForm({ email: "", displayName: "", note: "" });
      void queryClient.invalidateQueries({ queryKey: ["admins"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  return (
    <Card>
      <CardTitle>Give someone access</CardTitle>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          setAdded(null);
          grant.mutate();
        }}
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            label="Their email address"
            type="email"
            required
            autoComplete="off"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            problem={grant.error instanceof Error ? grant.error.message : undefined}
          />
          <Field
            label="Name"
            value={form.displayName}
            onChange={(event) =>
              setForm((current) => ({ ...current, displayName: event.target.value }))
            }
            hint="Optional."
          />
          <Field
            label="Why"
            value={form.note}
            onChange={(event) =>
              setForm((current) => ({ ...current, note: event.target.value }))
            }
            hint="Optional. Read in a year's time."
          />
        </div>
        <p className="max-w-prose text-sm text-[var(--muted-foreground)]">
          This sends nothing and creates no account. They get in once they have
          a staff account with this address and have confirmed it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={grant.isPending || !form.email.trim()}
          >
            {grant.isPending ? "Adding…" : "Add to the list"}
          </Button>
          {added && (
            <p role="status" className="text-sm text-[var(--muted-foreground)]">
              {added} is on the list.
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
