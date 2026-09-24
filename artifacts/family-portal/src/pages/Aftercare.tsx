import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAtHome } from "@/lib/utils";
import {
  useGetFamilySession,
  useSetFamilyAftercareConsent,
  getGetFamilySessionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

/** The home's calendar day — the day the note is sent from there. */
let homeZone: string | undefined;
function formatWhen(value: string | Date): string {
  return formatAtHome(value, homeZone, {
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
  const [email, setEmail] = useState<string>(
    () => session.data?.aftercare?.email ?? session.data?.contact.email ?? "",
  );
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);

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
  homeZone = home?.timezone;

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
          {home?.name} will write to you on the days below
          {aftercare.email ? `, at ${aftercare.email}` : ""}. You can stop
          them at any time.
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

        {/*
          Asked once, because it is final: the server will not start them
          again, and a stray tap on a phone should not cost somebody the note
          on the anniversary of their mother's death.
        */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full"
              disabled={respond.isPending}
            >
              Stop these
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop the notes?</AlertDialogTitle>
              <AlertDialogDescription>
                None of the rest will be sent, and they can't be started again
                from here. {home?.name ?? "The funeral home"} is still there if
                you need them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => respond.mutate({ data: { consent: false } })}
              >
                Stop them
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (aftercare.status === "done") {
    /*
     * Two different endings share this status: the family said no, or every
     * note went out and the year is over. Telling somebody who read all four
     * that "that's stopped" reads as though something was taken away.
     */
    const declined = aftercare.unsubscribedAt !== null;

    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--elevation-1)]">
        <h1 className="font-display text-[1.6rem] leading-tight">
          {declined ? "That's stopped" : "All of the notes have been sent"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {declined
            ? `You won't hear from us again about this. ${home?.name ?? "The funeral home"} is still there if you need them.`
            : `The last was on the anniversary. ${home?.name ?? "The funeral home"} is still there if you need them.`}
        </p>
      </div>
    );
  }

  const address = email.trim();
  const addressLooksRight = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);

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

      {/*
        Where they would go, asked here rather than assumed. The notes are
        email, and a relative the home added with only a mobile number used
        to be able to say yes to four dates that could never arrive.
      */}
      <div>
        <Label htmlFor="aftercare-email">The notes would go to</Label>
        <Input
          id="aftercare-email"
          type="email"
          autoComplete="email"
          className="mt-2"
          value={email}
          placeholder="Your email address"
          onChange={(event) => setEmail(event.target.value)}
        />
        {address.length > 0 && !addressLooksRight && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            That doesn't look quite like an email address yet.
          </p>
        )}
      </div>

      {/*
        Equal weight, not small print — and that means the same button, not a
        filled "yes" beside an outlined "no". A decline drawn as the lesser
        option is the thing the consent rules call a dark pattern.
      */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={respond.isPending || !addressLooksRight}
          onClick={() => {
            setAnswer("yes");
            respond.mutate({ data: { consent: true, email: address } });
          }}
        >
          {respond.isPending && answer === "yes" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Yes, please
        </Button>

        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={respond.isPending}
          onClick={() => {
            setAnswer("no");
            respond.mutate({ data: { consent: false } });
          }}
        >
          {respond.isPending && answer === "no" && (
            <Loader2 className="size-4 animate-spin" />
          )}
          No, thank you
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        If you say no, we won't ask again.
      </p>
    </div>
  );
}
