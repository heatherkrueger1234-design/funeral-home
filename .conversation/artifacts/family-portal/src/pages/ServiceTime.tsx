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
import { Empty, Loading, PageHeader } from "@/components/page";
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

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const asDate = (value: string | Date) =>
  value instanceof Date ? value : new Date(value);

const fullWhen = (value: string | Date) =>
  `${dayFormat.format(asDate(value))} at ${timeFormat.format(asDate(value))}`;

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
    },
  });

  if (offers.isPending) return <Loading rows={3} />;

  if (!offers.data) return null;

  const data = offers.data;
  const homeName = session.data?.home.name ?? "The funeral home";
  const settled = data.chosenOfferId !== null || data.serviceAt !== null;

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
          <p className="font-display text-xl">
            {data.serviceAt ? fullWhen(data.serviceAt) : "Confirmed"}
          </p>
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
              {data.homePhone}
            </a>
          </Button>
        )}
      </div>
    );
  }

  if (data.offers.length === 0) {
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
        {data.offers.map((offer: ServiceOffer) => (
          <li
            key={offer.id}
            className="rounded-xl border border-border bg-card px-4 py-4 shadow-[var(--elevation-1)]"
          >
            <p className="font-display text-lg">
              {dayFormat.format(asDate(offer.startsAt))}
            </p>
            <p className="text-muted-foreground">
              {timeFormat.format(asDate(offer.startsAt))}
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
        If none of these work, please ring {homeName}
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
              {confirming ? fullWhen(confirming.startsAt) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {homeName} will take this as settled and begin arranging around
              it. To change it afterwards you will need to ring them.
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
