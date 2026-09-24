import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyVendors,
  useGetFamilySession,
  useGetFamilyQuotes,
  useSetFamilyPostalCode,
  useRequestFamilyQuote,
  getGetFamilyVendorsQueryKey,
  getGetFamilySessionQueryKey,
  getGetFamilyQuotesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Check, MapPin, Phone } from "lucide-react";
import { Divider, Empty, LoadFailed, Loading, PageHeader } from "@/components/page";

/**
 * Local help: headstones, cemeteries, urns, someone to lead the service.
 *
 * These are questions families ask weeks later, when the funeral is over and
 * everyone has gone home — usually by ringing the director, who by then is
 * working three other cases. Having the home's own recommendations sitting
 * here, with a way to ask for a price, answers it without the phone call.
 *
 * Everything shown is a recommendation the funeral home chose to make. The
 * home takes no payment and sets no prices; asking for a quote passes the
 * request on, and whatever the vendor says is recorded so three headstone
 * quotes can be compared later without remembering three conversations.
 */

const GROUPS = [
  { kind: "monument", label: "Headstones and memorials" },
  { kind: "cemetery", label: "Cemeteries" },
  { kind: "casket", label: "Caskets" },
  { kind: "urn", label: "Urns" },
  { kind: "clergy", label: "Clergy" },
  { kind: "celebrant", label: "Celebrants" },
  { kind: "florist", label: "Flowers" },
  { kind: "musician", label: "Music" },
  { kind: "caterer", label: "Catering" },
  { kind: "transport", label: "Transport" },
  { kind: "other", label: "Anything else" },
] as const;

export default function Local() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const session = useGetFamilySession();
  const vendors = useGetFamilyVendors();
  const quotes = useGetFamilyQuotes();

  const [zip, setZip] = useState("");
  const [changingZip, setChangingZip] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const [request, setRequest] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetFamilyVendorsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilySessionQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFamilyQuotesQueryKey() });
  };

  const setPostalCode = useSetFamilyPostalCode({
    mutation: {
      onSuccess: (result) => {
        setChangingZip(false);
        refresh();
        setChangingZip(false);
        if (!result.recognised) {
          // Said plainly rather than silently showing an unsorted list.
          toast({
            title: "We don't recognize that ZIP",
            description:
              "We've saved it, but we can't work out distances from it. The funeral home can help.",
          });
        }
      },
    },
  });

  const askForQuote = useRequestFamilyQuote({
    mutation: {
      onSuccess: () => {
        setAsking(null);
        setRequest("");
        refresh();
        toast({
          title: "Passed to the funeral home",
          description: "They'll come back to you with a price.",
        });
      },
    },
  });

  if (session.isPending || vendors.isPending) return <Loading rows={4} />;

  if (vendors.isError && !vendors.data) {
    return <LoadFailed title="Local help" onRetry={() => void vendors.refetch()} />;
  }

  const postalCode = session.data?.case.postalCode ?? null;
  const rows = vendors.data ?? [];
  const asked = new Set((quotes.data ?? []).map((quote) => quote.vendorId));

  return (
    <div className="space-y-8">
      <PageHeader title="Local help">
        People {session.data?.home.name} works with and would recommend. You
        are under no obligation to use any of them.
      </PageHeader>

      {/*
        Asked once, here, where it is obviously needed.

        "Change" opens the same question again with the ZIP already in it.
        It used to send an empty ZIP to clear the old one, which the server
        refuses -- so the one way to correct a ZIP was a button that only
        ever produced an error.
      */}
      {!postalCode || changingZip ? (
        <section className="rounded-xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (zip.trim().length < 5 || setPostalCode.isPending) return;
              setPostalCode.mutate({ data: { postalCode: zip.trim() } });
            }}
          >
            <Label htmlFor="zip" className="mb-1.5 block">
              Whereabouts are you?
            </Label>
            <p id="zip-hint" className="mb-3.5 text-sm leading-relaxed text-muted-foreground">
              A ZIP code is enough. It lets us show you what's actually nearby.
            </p>
            <div className="flex gap-2">
              <Input
                id="zip"
                value={zip}
                placeholder="80202"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={10}
                aria-describedby="zip-hint"
                className="bg-white"
                onChange={(event) => setZip(event.target.value)}
              />
              <Button
                type="submit"
                disabled={zip.trim().length < 5 || setPostalCode.isPending}
              >
                Show what's near
              </Button>
            </div>
            {changingZip && (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 -ml-3"
                onClick={() => setChangingZip(false)}
              >
                Keep {postalCode}
              </Button>
            )}
          </form>
        </section>
      ) : (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" strokeWidth={1.75} />
          <span>
            Showing what's near <span className="tabular">{postalCode}</span>.
          </span>
          <button
            type="button"
            className="min-h-11 px-1 font-semibold text-[var(--accent-deep)] underline decoration-[var(--accent)]/40 underline-offset-4 hover:decoration-[var(--accent)]"
            onClick={() => {
              setZip(postalCode);
              setChangingZip(true);
            }}
          >
            Change
          </button>
        </p>
      )}

      {rows.length === 0 ? (
        <Empty icon={MapPin} title="Nothing here yet">
          Ask {session.data?.home.name} — they will know who to point you to,
          and a recommendation over the telephone is worth more than a list.
        </Empty>
      ) : (
        GROUPS.filter((group) =>
          rows.some((vendor) => vendor.kind === group.kind),
        ).map((group) => (
          <section key={group.kind} className="space-y-3">
            <Divider label={group.label} />

            <ul className="space-y-2.5">
              {rows
                .filter((vendor) => vendor.kind === group.kind)
                .map((vendor) => (
                  <li
                    key={vendor.id}
                    className="rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-1)]"
                  >
                    <p className="font-semibold">{vendor.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[vendor.city, vendor.region].filter(Boolean).join(", ")}
                      {vendor.distanceMiles !== null
                        ? ` · about ${vendor.distanceMiles} miles away`
                        : ""}
                    </p>
                    {vendor.notes && (
                      <p className="mt-2 text-sm leading-relaxed">
                        {vendor.notes}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {vendor.phone && (
                        <Button asChild variant="outline" size="sm">
                          <a href={`tel:${vendor.phone.replace(/[^\d+]/g, "")}`}>
                            <Phone className="size-4" />
                            {vendor.phone}
                          </a>
                        </Button>
                      )}

                      {asked.has(vendor.id) ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-semibold text-[var(--accent-deep)]">
                          <Check className="size-3.5" />
                          Price requested
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            // Each vendor's question starts empty, not with
                            // what was half-typed for the last one.
                            setAsking(vendor.id);
                            setRequest("");
                          }}
                        >
                          Ask for a price
                        </Button>
                      )}
                    </div>

                    {asking === vendor.id && (
                      <div className="mt-3 space-y-2.5 rounded-lg border border-border bg-[var(--sunken)] p-3">
                        <Textarea
                          rows={3}
                          aria-label={`What you'd like a price for from ${vendor.name}`}
                          value={request}
                          placeholder="What you're after — a double headstone, granite, room for my father later."
                          onChange={(event) => setRequest(event.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={askForQuote.isPending}
                            onClick={() =>
                              askForQuote.mutate({
                                data: {
                                  vendorId: vendor.id,
                                  request: request.trim() || null,
                                },
                              })
                            }
                          >
                            Send to the funeral home
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAsking(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      {/* A vendor who wrote back without a figure ("call us, it depends on
          the stone") has still answered, and the family should see it. */}
      {(quotes.data ?? []).some(
        (quote) => quote.quotedAmountCents !== null || quote.response,
      ) && (
        <section className="space-y-3">
          <Divider label="What they've told you" />
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]">
            {(quotes.data ?? [])
              .filter((quote) => quote.quotedAmountCents !== null || quote.response)
              .map((quote) => (
                <li
                  key={quote.id}
                  className="flex items-center gap-3 px-4 py-3.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {quote.vendorName}
                    </span>
                    {quote.response && (
                      <span className="block text-sm text-muted-foreground">
                        {quote.response}
                      </span>
                    )}
                  </span>
                  {quote.quotedAmountCents !== null && (
                    <span className="tabular shrink-0 font-semibold">
                      $
                      {(quote.quotedAmountCents / 100).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  )}
                </li>
              ))}
          </ul>
          <p className="border-l-2 border-[var(--accent)]/30 pl-4 text-sm leading-relaxed text-muted-foreground">
            These are the vendors' own prices, passed on as given. Nothing here
            is a charge from {session.data?.home.name}.
          </p>
        </section>
      )}
    </div>
  );
}
