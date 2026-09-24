import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyServiceOffers,
  useChooseFamilyServiceOffer,
  useGetFamilySession,
  getGetFamilyServiceOffersQueryKey,
  getGetFamilySessionQueryKey,
  getGetFamilyDeadlinesQueryKey,
} from "@workspace/api-client-react";
import type { ServiceOffer } from "@workspace/api-client-react";
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
} from "@/components/ui/alert-dialog";
import { Empty, LoadFailed, Loading, PageHeader } from "@/components/page";
import { formatAtHome } from "@/lib/utils";
import { CalendarCheck, CalendarClock, Loader2, Phone } from "lucide-react";

/**
 * The only decision this portal asks a family to make about the week ahead.
 *
 * Everywhere else they are answering questions about the past — who their
 * mother was, which photographs, which hymn — and there is no wrong answer
 * and no hurry. This one is different: it is final, other people are waiting
 * on it, and getting it wrong means a family arriving at the wrong hour.
 *
 * So it behaves differently from every other screen here. Nothing saves on
 * blur, nothing saves as you go; choosing takes a second, deliberate
 * confirmation that repeats the day and the time in full. And once it is
 * made, this screen stops offering buttons and offers a telephone number
 * instead, because moving an agreed funeral is a conversation with a person.
 */

/*
 * On the home's clock, not the phone's — see `formatAtHome`. The time a
 * family picks here is the time they will walk into the church, so it has to
 * be the church's time whatever state the phone reading it is in.
 */
function formatsFor(zone: string | undefined) {
  const day = (value: string | Date) =>
    formatAtHome(value, zone, { weekday: "long", day: "numeric", month: "long" });
  const time = (value: string | Date) =>
    formatAtHome(value, zone, { hour: "numeric", minute: "2-digit" });
  return { day, time, full: (value: string | Date) => `${day(value)} at ${time(value)}` };
}

export default function ServiceTime() {
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  const offers = useGetFamilyServiceOffers();
  const [confirming, setConfirming] = useState<ServiceOffer | null>(null);

  const choose = useChooseFamilyServiceOffer({
    mutation: {
      onSuccess: () => {
        setConfirming(null);
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyServiceOffersQueryKey(),
        });
        // Choosing sets the date and builds the timeline behind it, so both
        // the hub and the list of what is due are now out of date.
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyDeadlinesQueryKey(),
        });
      },
      /*
       * Most often a brother on another phone chose first. The dialog used
       * to stay open over a list that was no longer true, offering "Yes,
       * this one" again; close it and show what was actually settled. The
       * toast from the shared handler says why.
       */
      onError: () => {
        setConfirming(null);
        void queryClient.invalidateQueries({
          queryKey: getGetFamilyServiceOffersQueryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: getGetFamilySessionQueryKey(),
        });
      },
    },
  });

  const { day, time, full } = formatsFor(session.data?.home.timezone);

  if (offers.isPending) return <Loading rows={3} />;

  if (!offers.data) {
    return <LoadFailed title="The service" onRetry={() => void offers.refetch()} />;
  }

  const data = offers.data;
  const homeName = session.data?.home.name ?? "The funeral home";
  const settled = data.chosenOfferId !== null || data.serviceAt !== null;
  // A time that has already gone by is not a choice, whatever is still in
  // the list; the server refuses it too.
  const upcoming = data.offers.filter(
    (offer) => new Date(offer.startsAt).getTime() > Date.now(),
  );

  if (settled) {
    return (
      <div className="space-y-6">
        <PageHeader title="The service">
          This is settled. Nothing more is needed from you here.
        </PageHeader>

        <section className="relative overflow-hidden rounded-xl border border-border bg-card px-4 py-5 pl-5 shadow-[var(--elevation-1)]">
          {/* The home's colour down the edge, as everywhere else in the
              portal that something is confirmed rather than pending. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]"
          />
          <p className="eyebrow mb-2 flex items-center gap-1.5">
            <CalendarCheck className="size-3.5" strokeWidth={1.75} />
            Settled
          </p>
          {/* The day and the hour on lines of their own, as on the hub: run
              together at this size it broke as "Monday, September / 28 at
              10:00 AM", splitting the date in half. */}
          <p className="font-display text-xl">
            {data.serviceAt ? day(data.serviceAt) : "Confirmed"}
          </p>
          {data.serviceAt && (
            <p className="tabular mt-0.5 text-lg">{time(data.serviceAt)}</p>
          )}
          {data.serviceLocation && (
            <p className="mt-1 text-muted-foreground">{data.serviceLocation}</p>
          )}
        </section>

        <p className="text-sm leading-snug text-muted-foreground">
          If this has to change, please speak to {homeName} rather than
          waiting — they will have told the church, the printer and the
          florist.
        </p>

        {data.homePhone && (
          <Button asChild variant="outline" className="w-full">
            <a href={`tel:${data.homePhone.replace(/[^\d+]/g, "")}`}>
              <Phone className="size-4" />
              Call {data.homePhone}
            </a>
          </Button>
        )}
      </div>
    );
  }

  if (upcoming.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="The service">
          When it is, and where.
        </PageHeader>
        <Empty icon={CalendarClock} title="No time set yet">
          {homeName} will be in touch. There is nothing for you to do here
          until then.
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Choosing a time">
        {homeName} can do any of these. Choose whichever suits your family —
        there is no better answer, and nobody is waiting on you tonight.
      </PageHeader>

      <ul className="space-y-3">
        {upcoming.map((offer: ServiceOffer) => (
          <li
            key={offer.id}
            className="rounded-xl border border-border bg-card px-4 py-4 shadow-[var(--elevation-1)]"
          >
            <p className="font-display text-lg">
              {day(offer.startsAt)}
            </p>
            <p className="text-muted-foreground">
              {time(offer.startsAt)}
              {offer.location ? ` · ${offer.location}` : ""}
            </p>
            {offer.note && (
              <p className="mt-2 text-sm leading-snug text-muted-foreground">
                {offer.note}
              </p>
            )}
            <Button
              className="w-full mt-3"
              variant="outline"
              onClick={() => setConfirming(offer)}
            >
              Choose this one
            </Button>
          </li>
        ))}
      </ul>

      <p className="text-sm leading-snug text-muted-foreground">
        If none of these work, please call {homeName}
        {data.homePhone ? ` on ${data.homePhone}` : ""} — they would far rather
        hear that than have you pick the least bad one.
      </p>

      {/*
        The second tap. Not friction for its own sake: this is the one thing
        in the portal that cannot be undone from the portal, and the dialog
        says the date back in full so nobody settles a funeral by mis-tapping
        a list.
      */}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? full(confirming.startsAt) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {homeName} will take this as settled and begin arranging around
              it. To change it afterwards you will need to call them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              disabled={choose.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirming) {
                  choose.mutate({ offerId: confirming.id });
                }
              }}
            >
              {choose.isPending && <Loader2 className="size-4 animate-spin" />}
              Yes, this one
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
