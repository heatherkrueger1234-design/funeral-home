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
import { CalendarCheck, Loader2, Phone } from "lucide-react";

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

  if (offers.isPending) {
    return (
      <div className="py-16 grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!offers.data) return null;

  const data = offers.data;
  const homeName = session.data?.home.name ?? "The funeral home";
  const settled = data.chosenOfferId !== null || data.serviceAt !== null;

  if (settled) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl mb-1">The service</h1>
        </header>

        <section className="rounded-xl border border-[var(--accent)]
                            bg-[var(--accent-soft)] px-4 py-5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide
                        text-[var(--accent-deep)] mb-2">
            <CalendarCheck className="size-4" />
            Settled
          </p>
          <p className="font-display text-xl">
            {data.serviceAt ? fullWhen(data.serviceAt) : "Confirmed"}
          </p>
          {data.serviceLocation && (
            <p className="text-muted-foreground mt-1">{data.serviceLocation}</p>
          )}
        </section>

        <p className="text-sm text-muted-foreground">
          Nothing more is needed from you here. If this has to change, please
          speak to {homeName} rather than waiting — they will have told the
          church, the printer and the florist.
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
      <div className="space-y-4">
        <h1 className="font-display text-2xl">The service</h1>
        <p className="rounded-xl border border-dashed px-4 py-10 text-center
                      text-muted-foreground">
          {homeName} has not set a time yet. They will be in touch.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">Choosing a time</h1>
        <p className="text-muted-foreground">
          {homeName} can do any of these. Choose whichever suits your family —
          there is no better answer, and nobody is waiting on you tonight.
        </p>
      </header>

      <ul className="space-y-3">
        {data.offers.map((offer: ServiceOffer) => (
          <li
            key={offer.id}
            className="rounded-xl border border-border bg-card px-4 py-4"
          >
            <p className="font-display text-lg">
              {dayFormat.format(asDate(offer.startsAt))}
            </p>
            <p className="text-muted-foreground">
              {timeFormat.format(asDate(offer.startsAt))}
              {offer.location ? ` · ${offer.location}` : ""}
            </p>
            {offer.note && (
              <p className="text-sm text-muted-foreground mt-2">{offer.note}</p>
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

      <p className="text-sm text-muted-foreground">
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
