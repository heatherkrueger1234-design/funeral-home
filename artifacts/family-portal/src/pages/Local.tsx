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
import { Check, Loader2, MapPin, Phone } from "lucide-react";

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
        refresh();
        if (!result.recognised) {
          // Said plainly rather than silently showing an unsorted list.
          toast({
            title: "We don't recognise that ZIP",
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

  if (session.isPending || vendors.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const postalCode = session.data?.case.postalCode ?? null;
  const rows = vendors.data ?? [];
  const asked = new Set((quotes.data ?? []).map((quote) => quote.vendorId));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl mb-1">Local help</h1>
        <p className="text-muted-foreground">
          People {session.data?.home.name} works with and would recommend. You
          are under no obligation to use any of them.
        </p>
      </header>

      {/* Asked once, here, where it is obviously needed. */}
      {!postalCode ? (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4">
          <Label htmlFor="zip" className="mb-1.5 block">
            Whereabouts are you?
          </Label>
          <p className="mb-3 text-sm text-muted-foreground">
            A ZIP code is enough. It lets us show you what's actually nearby.
          </p>
          <div className="flex gap-2">
            <Input
              id="zip"
              value={zip}
              placeholder="80202"
              inputMode="numeric"
              className="bg-white"
              onChange={(event) => setZip(event.target.value)}
            />
            <Button
              disabled={zip.trim().length < 5 || setPostalCode.isPending}
              onClick={() =>
                setPostalCode.mutate({ data: { postalCode: zip.trim() } })
              }
            >
              Save
            </Button>
          </div>
        </section>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" />
          Showing what's near {postalCode}.
          <button
            type="button"
            className="underline"
            onClick={() =>
              setPostalCode.mutate({ data: { postalCode: "" } })
            }
          >
            Change
          </button>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
          Nothing here yet. Ask {session.data?.home.name} — they will know who
          to point you to.
        </p>
      ) : (
        GROUPS.filter((group) =>
          rows.some((vendor) => vendor.kind === group.kind),
        ).map((group) => (
          <section key={group.kind} className="space-y-3">
            <h2 className="font-display text-lg">{group.label}</h2>

            <ul className="space-y-2">
              {rows
                .filter((vendor) => vendor.kind === group.kind)
                .map((vendor) => (
                  <li
                    key={vendor.id}
                    className="rounded-xl border border-border bg-card p-4"
                  >
                    <p className="font-medium">{vendor.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {[vendor.city, vendor.region].filter(Boolean).join(", ")}
                      {vendor.distanceMiles !== null
                        ? ` · about ${vendor.distanceMiles} miles away`
                        : ""}
                    </p>
                    {vendor.notes && (
                      <p className="mt-1 text-sm">{vendor.notes}</p>
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
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Check className="size-4" />
                          Price requested
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAsking(vendor.id)}
                        >
                          Ask for a price
                        </Button>
                      )}
                    </div>

                    {asking === vendor.id && (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          rows={3}
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

      {(quotes.data ?? []).some((quote) => quote.quotedAmountCents !== null) && (
        <section className="space-y-3">
          <h2 className="font-display text-lg">Prices you've been given</h2>
          <ul className="space-y-2">
            {(quotes.data ?? [])
              .filter((quote) => quote.quotedAmountCents !== null)
              .map((quote) => (
                <li
                  key={quote.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{quote.vendorName}</span>
                    {quote.response && (
                      <span className="block text-sm text-muted-foreground">
                        {quote.response}
                      </span>
                    )}
                  </span>
                  <span className="font-medium">
                    ${(quote.quotedAmountCents! / 100).toLocaleString()}
                  </span>
                </li>
              ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            These are the vendors' own prices, passed on as given. Nothing here
            is a charge from {session.data?.home.name}.
          </p>
        </section>
      )}
    </div>
  );
}
