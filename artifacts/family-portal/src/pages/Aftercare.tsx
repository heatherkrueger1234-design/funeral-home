import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilySession,
  useSetFamilyAftercareConsent,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";

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

  if (session.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const aftercare = session.data?.aftercare;
  const home = session.data?.home;

  if (!aftercare) {
    return (
      <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
        There is nothing to decide here yet.
      </p>
    );
  }

  if (aftercare.status === "active") {
    return (
      <div className="space-y-5">
        <header>
          <h1 className="font-display text-2xl mb-1">Checking in</h1>
          <p className="text-muted-foreground">
            {home?.name} will write to you on the days below. You can stop them
            at any time.
          </p>
        </header>

        <ul className="space-y-2">
          {aftercare.deliveries.map((delivery) => (
            <li
              key={delivery.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <span className="flex-1">
                {DESCRIPTIONS[delivery.dayOffset] ??
                  `Day ${delivery.dayOffset}`}
              </span>
              <span className="text-sm text-muted-foreground">
                {delivery.sentAt ? "Sent" : formatWhen(delivery.dueAt)}
              </span>
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
      <div className="space-y-3">
        <h1 className="font-display text-2xl">That's stopped</h1>
        <p className="text-muted-foreground">
          You won't hear from us again about this. {home?.name} is still there
          if you need them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">
          Would you like us to check in?
        </h1>
        <p className="text-muted-foreground">
          {home?.name} can write to you a few times over the next year. Short
          notes, nothing to reply to, and no one else sees your address.
        </p>
      </header>

      <ul className="space-y-2">
        {aftercare.deliveries.map((delivery) => (
          <li
            key={delivery.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
          >
            <span className="flex-1">
              {DESCRIPTIONS[delivery.dayOffset] ?? `Day ${delivery.dayOffset}`}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatWhen(delivery.dueAt)}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted-foreground">
        The month mark is often harder than the week after, because the cards
        stop and everyone else goes back to work. The anniversary is on the
        list because it is the day most people no longer know the date.
      </p>

      <div className="space-y-2">
        <Button
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
          className="w-full"
          disabled={respond.isPending}
          onClick={() => respond.mutate({ data: { consent: false } })}
        >
          No, thank you
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        If you say no, we won't ask again.
      </p>
    </div>
  );
}
