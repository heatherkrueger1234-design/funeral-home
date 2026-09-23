import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  api,
  describeAccount,
  formatDate,
  formatDateTime,
  type AdminHomeDetail,
} from "@/lib/api";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Skeleton,
  Stat,
  Swatch,
} from "@/components/ui";
import { LicensurePanel } from "@/components/LicensurePanel";

/**
 * One home, and everything the platform is allowed to know about it.
 *
 * Read that second clause literally. There is no route from this page to a
 * case, a family, a photograph or an obituary, and there is not meant to be:
 * we are the processor and the home is the controller. What is here is the
 * account, the Colorado paperwork, the names of the people who work there,
 * and counts.
 */
export function HomeDetail({ homeId }: { homeId: number }) {
  const query = useQuery({
    queryKey: ["home", homeId],
    queryFn: () => api.get<AdminHomeDetail>(`/admin/homes/${homeId}`),
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28 w-full" />
        <LoadingRows rows={3} />
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        <Link href="/homes" className="text-sm underline">
          Back to the homes
        </Link>
      </div>
    );
  }

  const home = query.data;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/homes"
          className="text-sm text-[var(--muted-foreground)] hover:underline"
        >
          ← Homes
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 font-display text-2xl">
          <Swatch color={home.accentColor} name={home.name} />
          <span className="break-words">{home.name}</span>
        </h1>
        <p className="mt-1 text-[var(--muted-foreground)]">
          {[
            describeAccount(home),
            [home.city, home.region].filter(Boolean).join(", "),
            `Joined ${formatDate(home.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {home.suspendedAt && (
        <Card className="border-[var(--notice)] bg-[var(--notice-soft)]">
          <h2 className="font-display text-base">This home is suspended</h2>
          <p className="mt-1 max-w-prose text-sm">
            {home.suspendedReason ?? "No reason was recorded."} They cannot open
            new cases. Everything already in the home is still there, and
            families part-way through can still reach it.
          </p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Since {formatDateTime(home.suspendedAt)}.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>How much they are using it</CardTitle>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat
            label="Cases open now"
            value={home.engagement.casesActive}
            of={home.engagement.casesOpened}
          />
          <Stat
            label="Family links opened"
            value={home.engagement.familyLinksOpened}
            of={home.engagement.familyLinksCreated}
          />
          <Stat label="Photographs" value={home.engagement.photographs} />
          <Stat
            label="Aftercare consented"
            value={home.engagement.aftercareConsented}
            of={home.engagement.aftercareEnrolled}
          />
        </div>
        {home.engagement.aftercareEnrolled > 0 && (
          <p className="mt-4 max-w-prose text-sm text-[var(--muted-foreground)]">
            {home.engagement.aftercareDeclined} families were enrolled in
            aftercare and have not answered either way, and{" "}
            {home.engagement.aftercareUnsubscribed} asked to stop. Neither is a
            failure; most people never reply to anything in that first year.
          </p>
        )}
      </Card>

      <LicensurePanel home={home} />

      <Card>
        <CardTitle>Who works here</CardTitle>
        {home.staff.length === 0 ? (
          <EmptyState
            title="Nobody can sign in yet"
            detail="This home has no staff accounts, so nobody can reach it. An owner has to be invited before it is any use to them."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {home.staff.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
              >
                <span>{person.displayName ?? "Not named yet"}</span>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {[person.title, person.role].filter(Boolean).join(" · ")}
                  {person.deactivatedAt && " · no longer here"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 max-w-prose text-sm text-[var(--muted-foreground)]">
          Names and roles only. Their email addresses are the home's business,
          not ours.
        </p>
      </Card>

      <SuspensionCard home={home} />
    </div>
  );
}

/**
 * The one destructive control in the console, and it is built to be slow.
 *
 * Typing a reason is required by the API, and it is required here for the
 * same purpose: it makes suspending a funeral home a sentence somebody wrote
 * rather than a button somebody clicked, and it is what the audit log will
 * still be saying in a year.
 */
function SuspensionCard({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);

  const change = useMutation({
    mutationFn: (suspended: boolean) =>
      api.put(`/admin/homes/${home.id}/suspension`, {
        suspended,
        ...(suspended ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      setConfirming(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["home", home.id] });
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  if (home.suspendedAt) {
    return (
      <Card>
        <CardTitle>Suspension</CardTitle>
        <p className="mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
          Lifting this lets the home open cases again straight away. Nothing
          else changes, because nothing else was taken away.
        </p>
        <Button
          variant="primary"
          disabled={change.isPending}
          onClick={() => change.mutate(false)}
        >
          {change.isPending ? "Lifting…" : "Lift the suspension"}
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>Suspension</CardTitle>
      <p className="mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
        Suspending stops this home opening new cases. It does not delete
        anything, does not lock them out, and does not cut off a family
        part-way through uploading photographs of their mother. It is the
        smallest thing that gets somebody's attention.
      </p>

      {confirming ? (
        <div className="flex flex-col gap-4">
          <Field
            label="Why is this home being suspended?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="This goes in the access log, and it is what you will read in six months when somebody asks."
            problem={
              change.error instanceof Error ? change.error.message : undefined
            }
          />
          <div className="flex gap-3">
            <Button
              variant="destructive"
              disabled={change.isPending || !reason.trim()}
              onClick={() => change.mutate(true)}
            >
              {change.isPending ? "Suspending…" : `Suspend ${home.name}`}
            </Button>
            <Button variant="plain" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="quiet" onClick={() => setConfirming(true)}>
          Suspend this home
        </Button>
      )}
    </Card>
  );
}
