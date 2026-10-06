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

const TOUCHPOINTS: Record<string, string> = {
  birthday: "Their birthday",
  holidays: "Before the first holidays",
  death_anniversary: "A year since they died",
};

function describe(delivery: { kind: string; dayOffset: number }): string {
  return (
    TOUCHPOINTS[delivery.kind] ??
    DESCRIPTIONS[delivery.dayOffset] ??
    `Day ${delivery.dayOffset}`
  );
}

export default function Aftercare() {
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const [email, setEmail] = useState<string>(
    () => session.data?.aftercare?.email ?? session.data?.contact.email ?? "",
  );
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [byText, setByText] = useState(false);
  const [phone, setPhone] = useState<string>(
    () => session.data?.aftercare?.phone ?? session.data?.contact.phone ?? "",
  );
  const [extras, setExtras] = useState(false);

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
      <div className="space-y-6">
        <PageHeader title="Checking in" />
        <Empty icon={Mail} title="There is nothing to decide here yet">
          If the funeral home offers to keep in touch over the coming year, the
          question will appear here.
        </Empty>
      </div>
    );
  }

  if (aftercare.status === "active") {
    return (
      <div className="space-y-6">
        <PageHeader title="Checking in">
          {home?.name} will write to you on the days below
          {aftercare.email ? `, at ${aftercare.email}` : ""}
          {aftercare.smsConsentAt ? ", with a short text too" : ""}. You can
          stop them at any time.
        </PageHeader>

        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]">
          {/* A note that came too late to send is left out, like a withdrawn
              one: listing it would only tell a family what they missed. */}
          {aftercare.deliveries.filter((d) => d.sentVia !== "withdrawn" && d.sentVia !== "missed").map((delivery) => (
            <li
              key={delivery.id}
              className="flex items-center gap-3 px-4 py-3.5"
            >
              <span className="flex-1 font-medium">
                {describe(delivery)}
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
          Asked once more, because it is final: the server never re-asks a
          family who has said no, so there is no "start them again" later.
        */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full" disabled={respond.isPending}>
              Stop these
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop the check-ins?</AlertDialogTitle>
              <AlertDialogDescription>
                No more notes will be sent, and you won't be asked again. If
                you ever want to talk, the funeral home is still there.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep them</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => respond.mutate({ data: { consent: false } })}
              >
                Yes, stop them
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
  const phoneLooksRight = phone.replace(/\D/g, "").length >= 10;
  // Email, or a text instead, or both.
  const canSayYes =
    (address.length === 0 || addressLooksRight) &&
    (addressLooksRight || (byText && phoneLooksRight)) &&
    (!byText || phoneLooksRight);
  const offered = aftercare.touchpointsOffered ?? [];

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
              {describe(delivery)}
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
        {/* Said whenever "Yes, please" cannot be pressed, so a greyed-out
            button is never the only thing on the screen explaining itself. */}
        {!addressLooksRight && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {address.length === 0
              ? byText
                ? "Leave this empty to have the notes by text only."
                : "The notes come by email, so an address is needed — or choose texts below."
              : "That doesn't look quite like an email address yet."}
          </p>
        )}
      </div>

      {aftercare.smsAvailable && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={byText}
              onChange={(event) => setByText(event.target.checked)}
            />
            <span>
              <span className="block font-medium">Also send a short text</span>
              <span className="block text-muted-foreground">
                One text on each of these days from {home?.name}. Message and
                data rates may apply. Reply STOP at any time to stop them, or
                HELP for help.
              </span>
            </span>
          </label>
          {byText && (
            <Input
              type="tel"
              autoComplete="tel"
              aria-label="Your mobile number"
              value={phone}
              placeholder="Your mobile number"
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </div>
      )}

      {offered.length > 0 && (
        <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={extras}
            onChange={(event) => setExtras(event.target.checked)}
          />
          <span>
            <span className="block font-medium">And on the harder days</span>
            <span className="block text-muted-foreground">
              {offered
                .map((t) => `${TOUCHPOINTS[t.kind] ?? t.kind} (${formatWhen(t.dueAt)})`)
                .join(", ")}
              . Only if you would like them.
            </span>
          </span>
        </label>
      )}

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
          disabled={respond.isPending || !canSayYes}
          onClick={() => {
            setAnswer("yes");
            respond.mutate({
              data: {
                consent: true,
                email: address || null,
                sms: byText,
                phone: byText ? phone.trim() : null,
                touchpoints: extras,
              },
            });
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
