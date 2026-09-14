import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilySession,
  useSetFamilyAftercareConsent,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Check, Loader2, Mail } from "lucide-react";
import { Empty, Loading, PageHeader } from "@/components/page";

/**
 * The one thing in this portal that asks the family for something rather
 * than from them.
 *
 * Everything about this screen is shaped by the fact that grief mail nobody
 * agreed to is a complaint to the funeral home. So: the dates are shown
 * plainly, the sender is named, declining is a button of equal weight rather
 * than a link in small print, and "no" is final — nothing in this codebase
 * asks a second time.
 *
 * It is also deliberately not a marketing page. No benefits list, no
 * reassurance about how helpful it will be. A short description of exactly
 * what would arrive and when, and two buttons.
 */

function formatWhen(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const DESCRIPTIONS: Record<number, string> = {
  30: "A month on",
  60: "Two months on",
  90: "Three months on",
  365: "The anniversary",
};

export default function Aftercare() {
  const queryClient = useQueryClient();
  const session = useGetFamilySession();

  const respond = useSetFamilyAftercareConsent({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
      },
    },
  });

  if (session.isPending) return <Loading rows={3} />;

  const aftercare = session.data?.aftercare;
  const home = session.data?.home;

  if (!aftercare) {
    return (
      <Empty icon={Mail} title="There is nothing to decide here yet">
        If the funeral home offers to keep in touch over the coming year, the
        question will appear here.
      </Empty>
    );
  }

  if (aftercare.status === "active") {
    return (
      <div className="space-y-6">
        <PageHeader title="Checking in">
          {home?.name} will write to you on the days below. You can stop them
          at any time.
        </PageHeader>

        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]">
          {aftercare.deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              <span className="flex-1 font-medium">
                {DESCRIPTIONS[delivery.dayOffset] ??
                  `Day ${delivery.dayOffset}`}
              </span>
              {delivery.sentAt ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Check className="size-3.5" />
                  Sent
                </span>
              ) : (
                <span className="tabular text-sm text-muted-foreground">
                  {formatWhen(delivery.dueAt)}
                </span>
              )}
            </li>
          ))}
        </ul>

        <Button
          variant="outline"
          className="w-full"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ data: { consent: false } })}
        >
          Stop these
        </Button>
      </div>
    );
  }

  if (aftercare.status === "done") {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--elevation-1)]">
        <h1 className="font-display text-[1.6rem] leading-tight">
          That's stopped
        </h1>
        <p className="mt-2 text-muted-foreground">
          You won't hear from us again about this. {home?.name} is still there
          if you need them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader title="Would you like us to check in?">
        {home?.name} can write to you a few times over the next year. Short
        notes, nothing to reply to, and no one else sees your address.
      </PageHeader>

      {/*
        Shown before the question is answered, not after. "A few times over the
        next year" is not something anybody can consent to; four dates is.
      */}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]">
        {aftercare.deliveries.map((delivery) => (
          <li key={delivery.id} className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex-1 font-medium">
              {DESCRIPTIONS[delivery.dayOffset] ?? `Day ${delivery.dayOffset}`}
            </span>
            <span className="tabular text-sm text-muted-foreground">
              {formatWhen(delivery.dueAt)}
            </span>
          </li>
        ))}
      </ul>

      <p className="border-l-2 border-[var(--accent)]/30 pl-4 text-sm leading-relaxed text-muted-foreground">
        The month mark is often harder than the week after, because the cards
        stop and everyone else goes back to work. The anniversary is on the
        list because it is the day most people no longer know the date.
      </p>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Button
          size="lg"
          className="w-full"
          disabled={respond.isPending}
          onClick={() =>
            respond.mutate({
              data: { consent: true, email: aftercare.email ?? null },
            })
          }
        >
          {respond.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Yes, please
        </Button>

        {/* Equal weight, not small print. */}
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ data: { consent: false } })}
        >
          No, thank you
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        If you say no, we won't ask again.
      </p>
    </div>
  );
}
