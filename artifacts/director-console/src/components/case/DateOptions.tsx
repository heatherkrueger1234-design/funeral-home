import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetServiceOffers,
  useCreateServiceOffer,
  useConfirmServiceOffer,
  useDeleteServiceOffer,
  getGetServiceOffersQueryKey,
  getGetCaseQueryKey,
  getGetCasesQueryKey,
  getGetDeadlinesQueryKey,
  getGetHomeDashboardQueryKey,
} from "@workspace/api-client-react";
import type { ServiceOffer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Phone, Plus, X } from "lucide-react";

/**
 * Offering the family two or three times, instead of ringing round for one.
 *
 * The call this replaces is the one that never lands cleanly: the director
 * rings on Tuesday with "Friday at eleven or Saturday at two", reaches a son
 * who has to ask his sister, the sister rings the office back while he is
 * driving, and two days later somebody arrives at the wrong hour. Written
 * down, the family answers it at whatever hour they are awake and together.
 *
 * Only times the home has already confirmed it can do belong here. This
 * books nothing — the church and the crematorium keep their own calendars,
 * and a system that pretended otherwise would be confidently wrong about the
 * one fact everybody is relying on.
 *
 * The screen has to make one thing unmissable: choosing is what sets the
 * service date, and the service date is what builds the timeline. A director
 * should see that happen, which is why the confirmation says how many steps
 * were dated rather than just "saved".
 */

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const asDate = (value: string | Date) =>
  value instanceof Date ? value : new Date(value);

/** `datetime-local` wants local wall time with no zone, to the minute. */
function toLocalInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** The floor on the picker. Nothing already past is on offer. */
const localNow = () => toLocalInput(new Date());

/** Three days out at eleven, which is where most of these land anyway. */
function defaultOfferTime(): string {
  const when = new Date();
  when.setDate(when.getDate() + 3);
  when.setHours(11, 0, 0, 0);

  return toLocalInput(when);
}

export function DateOptions({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const offers = useGetServiceOffers(caseId);

  const [startsAt, setStartsAt] = useState(defaultOfferTime);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetServiceOffersQueryKey(caseId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetCaseQueryKey(caseId) });
    void queryClient.invalidateQueries({ queryKey: getGetCasesQueryKey() });
    void queryClient.invalidateQueries({
      queryKey: getGetDeadlinesQueryKey(caseId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetHomeDashboardQueryKey(),
    });
  };

  const add = useCreateServiceOffer({
    mutation: {
      onSuccess: () => {
        setNote("");
        setAdding(false);
        refresh();
      },
    },
  });

  const confirm = useConfirmServiceOffer({
    mutation: {
      onSuccess: (result) => {
        refresh();
        toast({
          title: "Service date set",
          description:
            result.scheduleCreated + result.scheduleMoved === 0
              ? "The family can see it. Your standard schedule added nothing — check it under Settings."
              : `The family can see it, and ${result.scheduleCreated} ${
                  result.scheduleCreated === 1 ? "step is" : "steps are"
                } now dated on their timeline.`,
        });
      },
    },
  });

  const withdraw = useDeleteServiceOffer({ mutation: { onSuccess: refresh } });

  if (offers.isPending) {
    return (
      <div className="py-6 text-center">
        <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = offers.data ?? [];
  const chosen = rows.find((row: ServiceOffer) => row.chosenAt !== null);

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border bg-[var(--sunken)] p-4">
      <div>
        <h3 className="font-semibold">Or let the family pick</h3>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          Offer two or three times you can actually do. Whichever they choose
          becomes the service date, and their timeline is built from it.
        </p>
      </div>

      {chosen ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-[var(--accent-deep)]" strokeWidth={1.75} />
            {dayFormat.format(asDate(chosen.startsAt))} at{" "}
            {timeFormat.format(asDate(chosen.startsAt))}
          </p>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            {chosen.chosenByName
              ? `Chosen by ${chosen.chosenByName}.`
              : "Recorded by the home."}{" "}
            To move it now, change the service date above and tell them
            yourself — the family believe this is settled.
          </p>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((row: ServiceOffer) => (
                <li
                  key={row.id}
                  className="flex items-start gap-3 rounded-xl border
                             border-border bg-card px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {dayFormat.format(asDate(row.startsAt))} at{" "}
                      {timeFormat.format(asDate(row.startsAt))}
                    </span>
                    {(row.location || row.note) && (
                      <span className="block truncate text-sm text-muted-foreground">
                        {[row.location, row.note].filter(Boolean).join(" — ")}
                      </span>
                    )}
                  </span>

                  {/*
                    Most families over sixty ring rather than tap. This is the
                    same action the family's own button performs, so the
                    timeline is built either way.
                  */}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={confirm.isPending}
                    onClick={() =>
                      confirm.mutate({ caseId, offerId: row.id })
                    }
                  >
                    <Phone className="size-3.5" />
                    They chose this
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    aria-label="Withdraw this time"
                    onClick={() => withdraw.mutate({ offerId: row.id })}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="offerAt" className="text-xs">
                    When
                  </Label>
                  <Input
                    id="offerAt"
                    type="datetime-local"
                    // The server refuses a time that has already gone; the
                    // picker should not offer one in the first place, so a
                    // mistyped year is caught before it becomes a toast.
                    min={localNow()}
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="offerWhere" className="text-xs">
                    Where <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="offerWhere"
                    value={location}
                    placeholder="Same as the case"
                    onChange={(event) => setLocation(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="offerNote" className="text-xs">
                  What you would have said on the telephone
                </Label>
                <Input
                  id="offerNote"
                  value={note}
                  placeholder="Father Reilly can do this one"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!startsAt || add.isPending}
                  onClick={() =>
                    add.mutate({
                      caseId,
                      data: {
                        startsAt: new Date(startsAt).toISOString() as never,
                        location: location.trim() || null,
                        note: note.trim() || null,
                      },
                    })
                  }
                >
                  {add.isPending && <Loader2 className="size-4 animate-spin" />}
                  Offer it
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              {rows.length === 0 ? "Offer a time" : "Offer another"}
            </Button>
          )}

          {rows.length > 0 && (
            <p className="text-sm leading-snug text-muted-foreground">
              The family sees these the next time they open their link.
            </p>
          )}
        </>
      )}
    </div>
  );
}
