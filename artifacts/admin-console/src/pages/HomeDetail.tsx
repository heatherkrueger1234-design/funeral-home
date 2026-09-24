import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  api,
  AUDIT_ACTION_LABELS,
  cn,
  describeAccount,
  formatDate,
  formatDay,
  formatDateTime,
  isNotFound,
  plural,
  STAFF_ROLE_LABELS,
  type AdminGroup,
  type AdminHomeDetail,
  type AuditEntry,
} from "@/lib/api";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  LoadingRows,
  Missing,
  Select,
  Skeleton,
  Stat,
  Swatch,
  usePageTitle,
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

  usePageTitle(query.data?.name ?? (query.error ? "Home" : null));
  const [ownerInvite, setOwnerInvite] = useState<{ mailSent: boolean } | null>(
    null,
  );

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-28 w-full" />
        <LoadingRows rows={3} />
      </div>
    );
  }

  if (isNotFound(query.error)) {
    return (
      <Missing
        title="That home isn't here"
        detail="There is no home at this address. It may have been typed wrong."
        back={{ href: "/homes", label: "Back to the homes" }}
      />
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
          {home.internalAccount && (
            <span className="rounded-sm bg-[var(--accent-soft)] px-1.5 py-0.5 font-sans text-xs font-semibold text-[var(--accent-deep)]">
              Ours
            </span>
          )}
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
        {/* What you need to ring them or find them, and nothing more. */}
        <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
          {[
            home.phone,
            `Web address “${home.slug}”`,
            home.timezone.replace(/_/g, " "),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Link
          href={`/audit?homeId=${home.id}`}
          className="mt-2 inline-block text-sm text-[var(--muted-foreground)] underline underline-offset-4 hover:text-[var(--foreground)]"
        >
          This home in the access log
        </Link>
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

      <AccountCard home={home} />

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
            {plural(home.engagement.aftercareEnrolled, "family", "families")}{" "}
            enrolled in aftercare: {home.engagement.aftercareConsented} said
            yes, {home.engagement.aftercareDeclined} have not answered either
            way, and {home.engagement.aftercareUnsubscribed} asked to stop.
            None of that is a failure; most people never reply to anything in
            that first year.
          </p>
        )}
      </Card>

      <LicensurePanel home={home} />

      <Card>
        <CardTitle>Who works here</CardTitle>
        {/*
          The outcome is held out here rather than in the form, because a
          successful invitation refetches the home, the home then has an
          owner, and the form -- with the only sentence saying whether the
          email went -- would vanish the moment it appeared.
        */}
        {ownerInvite !== null ? (
          <InviteOutcome mailSent={ownerInvite.mailSent} />
        ) : (
          !home.staff.some((person) => person.role === "owner") && (
            <InviteOwner home={home} onInvited={setOwnerInvite} />
          )
        )}
        {home.staff.length === 0 ? null : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {home.staff.map((person) => (
              <StaffRow key={person.id} homeId={home.id} person={person} />
            ))}
          </ul>
        )}
        <p className="mt-4 max-w-prose text-sm text-[var(--muted-foreground)]">
          Names and roles only. Their email addresses are the home's business,
          not ours — a reset link goes to the address on their account, and
          is never shown here.
        </p>
      </Card>

      <GroupCard home={home} />

      <SuspensionCard home={home} />

      <OursCard home={home} />

      <AccessHistory home={home} />
    </div>
  );
}

/**
 * The account, with the dates behind the one-line status.
 *
 * "On trial, 3 days left" answers the question on the day. The follow-up
 * email needs the date, "subscribed" needs to say until when, and a home
 * whose bill is paid by a group needs to say which group -- because nothing
 * about its billing can be changed from here, and the person on the phone
 * should know that before they promise anything.
 */
function AccountCard({ home }: { home: AdminHomeDetail }) {
  const rows: Array<[string, string]> = [
    ["Account", describeAccount(home)],
    [
      "Can open new cases",
      home.canOpenCases
        ? "Yes"
        : home.suspendedAt
          ? "No — suspended"
          : "No — the trial or subscription has ended",
    ],
  ];

  if (home.subscriptionStatus === "trial") {
    rows.push(["Trial ends", formatDay(home.trialEndsAt)]);
  }
  if (home.currentPeriodEndsAt) {
    rows.push([
      home.subscriptionStatus === "canceled" ? "Paid until" : "Renews",
      formatDay(home.currentPeriodEndsAt),
    ]);
  }
  rows.push([
    "Billed through",
    home.groupId
      ? (home.groupName ?? `Group #${home.groupId}`)
      : "Its own subscription",
  ]);

  return (
    <Card>
      <CardTitle>Account</CardTitle>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-[var(--muted-foreground)]">{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {home.subscriptionStatus === "trial" && home.groupId === null && (
        <ExtendTrial home={home} />
      )}
    </Card>
  );
}

/**
 * More trial time, in days, up to sixty.
 *
 * A number and a button rather than a date picker: "give them another two
 * weeks" is how the request arrives, and the server counts from whichever is
 * later, today or the current end, so the answer is never less time than
 * they already had.
 */
function ExtendTrial({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState("14");
  const parsed = Number(days);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 60;

  const extend = useMutation({
    mutationFn: () =>
      api.post(`/admin/homes/${home.id}/extend-trial`, { days: parsed }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home", home.id] });
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  return (
    <form
      className="mt-6 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) extend.mutate();
      }}
    >
      <div className="w-40">
        <Field
          label="Extend the trial by"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          hint="Days, 1 to 60."
          problem={
            extend.error instanceof Error ? extend.error.message : undefined
          }
        />
      </div>
      <Button type="submit" disabled={!valid || extend.isPending}>
        {extend.isPending ? "Extending…" : "Extend the trial"}
      </Button>
      {extend.isSuccess && (
        <p role="status" className="w-full text-sm">
          Done. The owner will be reminded a week before the new end date.
        </p>
      )}
    </form>
  );
}

/**
 * An owner for a home that has none.
 *
 * A home created without an owner's address used to say "an owner has to be
 * invited" and offer no way to do it. The invitation goes to the address
 * typed here and the link in it is never shown on this page -- whoever holds
 * it chooses the owner's password.
 */
function InviteOutcome({ mailSent }: { mailSent: boolean }) {
  return (
    <p
      role={mailSent ? "status" : "alert"}
      className={cn(
        "mb-5 max-w-prose rounded-md p-3 text-sm",
        mailSent ? "bg-[var(--accent-soft)]" : "bg-[var(--notice-soft)]",
      )}
    >
      {mailSent
        ? "The invitation is on its way. They choose their own password from it."
        : "The owner's account exists, but no invitation was sent: mail is not set up on this deployment, or the mail server would not take it. Once mail is working, use “Resend the invitation” next to their name below."}
    </p>
  );
}

function InviteOwner({
  home,
  onInvited,
}: {
  home: AdminHomeDetail;
  onInvited: (outcome: { mailSent: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const invite = useMutation({
    mutationFn: () =>
      api.post<{ mailSent: boolean }>(`/admin/homes/${home.id}/invite-owner`, {
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      }),
    onSuccess: (outcome) => {
      onInvited(outcome);
      void queryClient.invalidateQueries({ queryKey: ["home", home.id] });
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  return (
    <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--sunken)] p-5">
      <h3 className="font-display text-base">Nobody owns this home yet</h3>
      <p className="mt-1 max-w-prose text-sm text-[var(--muted-foreground)]">
        Until somebody is invited as its owner, nobody at the home can sign in
        or add their colleagues. They get an email and choose their own
        password; nobody here ever sees it.
      </p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate();
        }}
      >
        <Field
          label="Owner's email address"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          problem={
            invite.error instanceof Error ? invite.error.message : undefined
          }
        />
        <Field
          label="Their name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Optional."
        />
        <Button
          type="submit"
          variant="primary"
          disabled={invite.isPending || !email.trim()}
        >
          {invite.isPending ? "Inviting…" : "Invite the owner"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Who at the platform has looked at this home, most recent first.
 *
 * The same log as the Access log page, narrowed to one home -- the answer to
 * "who at the vendor has seen our account", which is the question this home
 * is most likely to ask about us. Reading it writes nothing.
 */
function AccessHistory({ home }: { home: AdminHomeDetail }) {
  const query = useQuery({
    queryKey: ["audit", { homeId: home.id, preview: true }],
    queryFn: () =>
      api.get<AuditEntry[]>(`/admin/audit?homeId=${home.id}&limit=10`),
  });

  return (
    <Card>
      <CardTitle
        action={
          <Link
            href={`/audit?homeId=${home.id}`}
            className="text-sm underline underline-offset-4"
          >
            The whole history
          </Link>
        }
      >
        Access history
      </CardTitle>
      {query.isPending ? (
        <LoadingRows rows={3} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Nothing yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {query.data.map((entry) => (
            <li key={entry.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
              <span className="tabular text-[var(--muted-foreground)]">
                {formatDateTime(entry.createdAt)}
              </span>{" "}
              <span className="break-all">{entry.actorEmail}</span>{" "}
              {AUDIT_ACTION_LABELS[entry.action]?.toLowerCase() ?? entry.action}
              {entry.detail && (
                <span className="text-[var(--muted-foreground)]">
                  {" "}
                  — {entry.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * One person at the home, and the "I can't get in" call.
 *
 * The two facts that explain most of those calls sit next to the name: they
 * never finished their invitation, or their address has never received
 * anything from us. And the one thing the platform can do about it: email a
 * fresh reset link to the address on their own account. The link is never
 * shown here -- a console that could show it could sign in as them.
 */
function StaffRow({
  homeId,
  person,
}: {
  homeId: number;
  person: AdminHomeDetail["staff"][number];
}) {
  const queryClient = useQueryClient();

  const reset = useMutation({
    mutationFn: () =>
      api.post<{ mailConfigured: boolean }>(
        `/admin/homes/${homeId}/staff/${person.id}/password-reset`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["audit"] });
    },
  });

  // Somebody who never chose a password gets their invitation again rather
  // than a "reset your password" email for a password they never had -- the
  // server decides, and the button says which it will be.
  const invitation = !person.hasPassword;

  const state = person.deactivatedAt
    ? "No longer here"
    : !person.hasPassword
      ? "Has not finished their invitation"
      : !person.emailVerified
        ? "Address not confirmed yet"
        : null;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <span className="mr-3">{person.displayName ?? "Not named yet"}</span>
        <span className="text-sm text-[var(--muted-foreground)]">
          {[person.title, STAFF_ROLE_LABELS[person.role] ?? person.role]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {state && (
          <p className="text-sm text-[var(--muted-foreground)]">{state}</p>
        )}
        {reset.isSuccess && (
          <p role="status" className="text-sm">
            {reset.data.mailConfigured
              ? invitation
                ? "A fresh invitation is on its way to the address on their account. It works once, for an hour."
                : "A reset link is on its way to the address on their account. It works once, for an hour."
              : "Mail is not set up on this deployment, so nothing was sent. (The server log records that it was asked for, never the link itself.)"}
          </p>
        )}
        {reset.error instanceof Error && (
          <p role="alert" className="text-sm text-[var(--notice)]">
            {reset.error.message}
          </p>
        )}
      </div>
      {!person.deactivatedAt && (
        <Button
          disabled={reset.isPending || reset.isSuccess}
          onClick={() => reset.mutate()}
        >
          {reset.isPending
            ? "Sending…"
            : reset.isSuccess
              ? reset.data.mailConfigured
                ? "Sent"
                : "Not sent"
              : invitation
                ? "Resend the invitation"
                : "Email a reset link"}
        </Button>
      )}
    </li>
  );
}

/**
 * Ours, or a customer's.
 *
 * The API has had this for a while; the console never showed it, so the only
 * way to take the platform's own home out of the customer figures was curl --
 * and a deployment whose admin signed up *after* the bootstrap ran (the
 * ordinary order) always had one extra "home on trial" that was us.
 */
function OursCard({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();

  const change = useMutation({
    mutationFn: (internalAccount: boolean) =>
      api.put(`/admin/homes/${home.id}/internal`, { internalAccount }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home", home.id] });
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  return (
    <Card>
      <CardTitle>
        {home.internalAccount ? "This home is ours" : "A customer"}
      </CardTitle>
      <p className="mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
        {home.internalAccount
          ? "It is left out of the homes list and every figure on the overview. It works exactly like any other home."
          : "If this is one of ours — a demo, or the account a platform admin signs in with — marking it ours takes it out of the customer figures. Nothing else about it changes."}
      </p>
      {change.error instanceof Error && (
        <p role="alert" className="mb-3 text-sm text-[var(--notice)]">
          {change.error.message}
        </p>
      )}
      <Button
        disabled={change.isPending}
        onClick={() => change.mutate(!home.internalAccount)}
      >
        {home.internalAccount ? "It's a customer" : "Mark as ours"}
      </Button>
    </Card>
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
  // `disabled={change.isPending}` only takes effect after a re-render, so a
  // double-click sent the request twice and wrote two "Suspended a home"
  // lines to the log shown to customers. A ref closes the gap synchronously.
  const inFlight = useRef(false);

  const change = useMutation({
    mutationFn: async (suspended: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await api.put(`/admin/homes/${home.id}/suspension`, {
          suspended,
          ...(suspended ? { reason: reason.trim() } : {}),
        });
      } finally {
        inFlight.current = false;
      }
    },
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
        {change.error instanceof Error && (
          <p role="alert" className="mb-3 text-sm text-[var(--notice)]">
            {change.error.message}
          </p>
        )}
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
            maxLength={400}
            autoFocus
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
            <Button
              variant="plain"
              onClick={() => {
                setConfirming(false);
                setReason("");
                change.reset();
              }}
            >
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

/**
 * Which contract covers this home.
 *
 * Most homes are independent and this card says so in one line. The two
 * moves -- into a group, out of one -- each change who pays, so each one
 * says exactly what will happen to the account before it happens, and the
 * API's two refusals (a home with its own subscription; a home not in a
 * group) come back here in its own words.
 *
 * The list of groups is fetched only when somebody starts a move. Asking
 * for it on every visit would write a "listed the groups" line to the log
 * each time anyone opened any home.
 */
function GroupCard({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [choice, setChoice] = useState("");

  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get<AdminGroup[]>("/admin/groups"),
    enabled: moving,
  });

  const move = useMutation({
    mutationFn: (groupId: number | null) =>
      api.put(`/admin/homes/${home.id}/group`, { groupId }),
    onSuccess: () => {
      setMoving(false);
      setChoice("");
      void queryClient.invalidateQueries({ queryKey: ["home", home.id] });
      void queryClient.invalidateQueries({ queryKey: ["homes"] });
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      void queryClient.invalidateQueries({ queryKey: ["group"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const cancel = () => {
    setMoving(false);
    setChoice("");
    move.reset();
  };

  const problem = move.error instanceof Error && (
    <p role="alert" className="text-sm text-[var(--notice)]">
      {move.error.message}
    </p>
  );

  if (home.group) {
    return (
      <Card>
        <CardTitle>Group</CardTitle>
        <p className="max-w-prose">
          Part of{" "}
          <Link href={`/groups/${home.group.id}`} className="font-semibold">
            {home.group.name}
          </Link>
          , and covered by its contract.
        </p>
        <p className="mt-2 mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
          Taking it out of the group puts it on a fourteen-day trial of its
          own, without the group's add-ons, so it keeps working while it sets
          up its own billing. Nothing in the home changes.
        </p>
        {moving ? (
          <div className="flex flex-col gap-3">
            {problem}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={move.isPending}
                onClick={() => move.mutate(null)}
              >
                {move.isPending
                  ? "Taking it out…"
                  : `Take it out of ${home.group.name}`}
              </Button>
              <Button variant="plain" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setMoving(true)}>Take it out of the group</Button>
        )}
      </Card>
    );
  }

  const chosen = groups.data?.find((group) => String(group.id) === choice);

  return (
    <Card>
      <CardTitle>Group</CardTitle>
      <p className="mb-4 max-w-prose text-sm text-[var(--muted-foreground)]">
        An independent home, on its own contract. If it belongs to a group
        that has one contract for many locations, moving it in puts it on the
        group's plan and the group's bill.
      </p>

      {!moving ? (
        <Button onClick={() => setMoving(true)}>Move into a group</Button>
      ) : groups.isPending ? (
        <LoadingRows rows={1} />
      ) : groups.error ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState
          title="There are no groups yet"
          detail="A group is set up once, on the Groups page, when a contract covering several locations is agreed. Then its locations are moved in from here."
          action={
            <div className="flex flex-wrap gap-3">
              <Link
                href="/groups"
                className="inline-flex min-h-11 items-center underline underline-offset-4"
              >
                Set up a group
              </Link>
              <Button variant="plain" onClick={cancel}>
                Cancel
              </Button>
            </div>
          }
        />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (chosen) move.mutate(chosen.id);
          }}
        >
          <div className="max-w-sm">
            <Select
              label="Which group"
              value={choice}
              onChange={(event) => {
                setChoice(event.target.value);
                move.reset();
              }}
            >
              <option value="">Choose a group</option>
              {groups.data.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({plural(group.locations, "location")})
                </option>
              ))}
            </Select>
          </div>
          {chosen && (
            <p className="max-w-prose text-sm">
              {home.name} will take on {chosen.name}'s contract straight away.
              If it pays for itself today, that subscription has to be
              cancelled first, or both would be charged.
            </p>
          )}
          {problem}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={!chosen || move.isPending}
            >
              {move.isPending
                ? "Moving…"
                : chosen
                  ? `Move into ${chosen.name}`
                  : "Move into the group"}
            </Button>
            <Button type="button" variant="plain" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
