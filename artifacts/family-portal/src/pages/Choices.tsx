import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addFamilyProvidedToStorefront,
  addFamilyStorefrontItem,
  addFamilyStorefrontPackage,
  fetchFamilyCataloguePhoto,
  familyPriceListUrl,
  familyStatementUrl,
  getGetFamilyStorefrontQueryKey,
  formatPrice,
  removeFamilyStorefrontLine,
  useGetFamilyStorefront,
  useGetFamilySession,
  type CatalogueItem,
  type PaymentHandoff,
  type MerchandiseSelectionLine,
} from "@workspace/api-client-react";
import { voiceFor } from "@/lib/voice";
import { FamilyImage } from "@/components/FamilyImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, Phone } from "lucide-react";

/**
 * Choosing an urn for your mother, which is not shopping.
 *
 * Everything an online shop does to make you buy more is absent, and each
 * absence is deliberate: no basket count, no "families also chose", no
 * ratings, no scarcity, no totals in a colour meant to worry you. What is
 * here instead is large photographs, one clear price each, and the freedom
 * to put the phone down and come back tomorrow — the selection saves as a
 * draft the director can see and talk through.
 *
 * Two behaviours are the Funeral Rule rather than taste. Caskets appear only
 * once this family has the General Price List, which is why the list is the
 * first thing on the page rather than a footnote. And "we are bringing our
 * own" is a first-class choice with no fee attached, because a home may not
 * refuse a casket or urn bought elsewhere and may not charge for taking one.
 */

/**
 * A photograph, when there is one, and nothing at all when there is not.
 *
 * Not a placeholder. A spreadsheet carries no images, so on the day a home
 * loads its catalogue every item is photographless — and a page of identical
 * grey rectangles reads as a broken shop rather than a quiet list. An item
 * without a picture is simply a name, a description and a price, which is
 * also the right shape for the half of this catalogue that is services and
 * would never have had a photograph anyway.
 */
function Photograph({ item }: { item: CatalogueItem }) {
  if (item.photoUploadId === null) return null;

  return (
    <FamilyImage
      uploadId={item.photoUploadId}
      fetcher={fetchFamilyCataloguePhoto}
      alt={item.name}
      className="aspect-[4/3] w-full rounded-lg object-cover"
      placeholderClassName="aspect-[4/3] w-full rounded-lg"
    />
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-7 w-2/3 rounded bg-muted" />
      <div className="h-24 rounded-xl bg-muted" />
      <div className="space-y-4">
        {[0, 1].map((key) => (
          <div key={key} className="space-y-2">
            <div className="h-44 rounded-lg bg-muted" />
            <div className="h-5 w-1/2 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Choices() {
  const queryClient = useQueryClient();
  const session = useGetFamilySession();
  /*
   * Refetched when the tab comes back into focus, which the rest of this
   * portal deliberately does not do. Here it is load-bearing: opening the
   * price list is what unlocks the caskets, it opens in a new tab, and
   * coming back to find nothing changed would read as the page being broken.
   */
  const storefront = useGetFamilyStorefront({
    query: {
      queryKey: getGetFamilyStorefrontQueryKey(),
      refetchOnWindowFocus: true,
    },
  });

  const [busy, setBusy] = useState(false);
  const [broughtIn, setBroughtIn] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetFamilyStorefrontQueryKey() });

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (storefront.isPending || session.isPending) return <Skeleton />;

  const data = storefront.data;
  const home = session.data?.home;
  if (!data || !home) return null;

  const voice = voiceFor(session.data?.case.kind);
  const { selection } = data;
  const confirmed = selection.status === "confirmed";
  const chosenItemIds = new Set(
    selection.lines
      .map((line) => line.catalogueItemId)
      .filter((id): id is number => id !== null),
  );

  const nothingToShow =
    data.categories.every((category) => category.items.length === 0) &&
    data.packages.length === 0;

  if (nothingToShow && selection.lines.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl">What {home.name} can arrange</h1>
        <p className="text-muted-foreground">
          {home.name} hasn't put their price list here yet. They will go
          through everything with you themselves — there is nothing you need to
          do in the meantime.
        </p>
        {home.phone && (
          <a
            href={`tel:${home.phone.replace(/[^\d+]/g, "")}`}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-border
                       bg-card px-4 py-3 text-[var(--accent-deep)]"
          >
            <Phone className="size-4" />
            Call {home.name} on {home.phone}
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl">What {home.name} can arrange</h1>
        <p className="text-muted-foreground max-w-prose">
          {confirmed
            ? `This is what you and ${home.name} agreed.`
            : voice.preNeed
              ? "Have a look in your own time. Nothing here is decided, and you can change any of it whenever you like."
              : "Have a look in your own time. Nothing here is decided until you have talked it through with " +
                home.name +
                ", and everything saves as you go."}
        </p>
      </header>

      {/*
        The price list comes first, on the page and in the sequence. A family
        is entitled to the whole list with every price on it before they are
        shown a single casket, and burying that behind the merchandise would
        be exactly the wrong way round.
      */}
      {data.hasGeneralPriceList && (
        <section className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-4">
          <h2 className="font-medium mb-1">The full price list</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Everything {home.name} offers, each with its own price. It is yours
            to keep, print, or take away and think about.
          </p>
          <a
            href={familyPriceListUrl("gpl")}
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent)]
                       px-4 py-2.5 font-medium text-white"
          >
            <FileText className="size-4" />
            Open the price list
          </a>
        </section>
      )}

      {selection.lines.length > 0 && (
        <Chosen
          lines={selection.lines}
          totalCents={selection.totalCents}
          readOnly={confirmed || busy}
          onRemove={(lineId) => void act(() => removeFamilyStorefrontLine(lineId))}
        />
      )}

      {confirmed && (
        <Paying
          payment={data.payment}
          homeName={home.name}
          isPlan={!data.mayDiscussPayment}
        />
      )}

      {!confirmed && (
        <>
          {data.packages.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="font-display text-xl">Chosen together</h2>
                <p className="text-sm text-muted-foreground max-w-prose">
                  {home.name} offers these as a set. Everything in one still
                  has its own price, and you can leave out anything you would
                  rather not have.
                </p>
              </div>

              {data.packages.map((pack) => (
                <article
                  key={pack.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <h3 className="font-medium">{pack.name}</h3>
                  {pack.description && (
                    <p className="text-sm text-muted-foreground">
                      {pack.description}
                    </p>
                  )}
                  <ul className="my-3 space-y-1 text-sm text-muted-foreground">
                    {pack.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-4">
                        <span>{item.name}</span>
                        <span className="tabular-nums">
                          {formatPrice(item.priceCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-center gap-3">
                    <p>
                      <span className="text-lg tabular-nums">
                        {formatPrice(pack.priceCents)}
                      </span>
                      {pack.itemisedTotalCents !== pack.priceCents && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          {formatPrice(pack.itemisedTotalCents)} separately
                        </span>
                      )}
                    </p>
                    <Button
                      className="ml-auto min-h-11"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void act(() => addFamilyStorefrontPackage({ packageId: pack.id }))
                      }
                    >
                      Choose this
                    </Button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {data.categories
            .filter((category) => category.items.length > 0)
            .map((category) => (
              <section key={category.id} className="space-y-3">
                <div>
                  <h2 className="font-display text-xl">{category.name}</h2>
                  {category.description && (
                    <p className="text-sm text-muted-foreground max-w-prose">
                      {category.description}
                    </p>
                  )}
                </div>

                <ul
                  className={
                    category.items.some((item) => item.photoUploadId !== null)
                      ? "grid gap-6 sm:grid-cols-2"
                      : "divide-y divide-border rounded-xl border border-border bg-card"
                  }
                >
                  {category.items.map((item) => (
                    <li
                      key={item.id}
                      className={
                        item.photoUploadId === null ? "space-y-2 p-4" : "space-y-2"
                      }
                    >
                      <Photograph item={item} />
                      <div>
                        <h3 className="font-medium">{item.name}</h3>
                        {item.description && (
                          <p className="text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="tabular-nums text-lg">
                          {formatPrice(item.priceCents)}
                          {item.priceUnit && (
                            <span className="ml-1 text-sm text-muted-foreground">
                              {item.priceUnit}
                            </span>
                          )}
                        </p>
                        <Button
                          variant={chosenItemIds.has(item.id) ? "secondary" : "outline"}
                          className="ml-auto min-h-11"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              addFamilyStorefrontItem({ itemId: item.id }),
                            )
                          }
                        >
                          {chosenItemIds.has(item.id) ? "Add another" : "Choose this"}
                        </Button>
                      </div>
                      {item.availability === "by_request" && (
                        <p className="text-sm text-muted-foreground">
                          {home.name} orders this in for you.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

          {data.hasGeneralPriceList && !data.casketsUnlocked && (
            <section className="rounded-xl border border-border bg-card px-4 py-4">
              <h2 className="font-medium mb-1">Caskets and outer burial containers</h2>
              <p className="text-sm text-muted-foreground">
                These are shown once you have the full price list, so that you
                see every price before you see any casket. Open the price list
                above and they will appear here.
              </p>
            </section>
          )}

          <section className="rounded-xl border border-border bg-card px-4 py-4 space-y-3">
            <div>
              <h2 className="font-medium mb-1">If you are bringing your own</h2>
              <p className="text-sm text-muted-foreground max-w-prose">
                If you already have an urn or a casket, or you have bought one
                somewhere else, {home.name} will use it. There is no charge for
                that, and nothing else changes.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bringing">What you are bringing</Label>
              <Input
                id="bringing"
                className="min-h-11"
                placeholder="Her mother's urn"
                value={broughtIn}
                onChange={(event) => setBroughtIn(event.target.value)}
              />
            </div>

            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy || broughtIn.trim() === ""}
              onClick={() =>
                void act(async () => {
                  await addFamilyProvidedToStorefront({ name: broughtIn.trim() });
                  setBroughtIn("");
                })
              }
            >
              Tell {home.name}
            </Button>
          </section>
        </>
      )}

      <p className="text-sm text-muted-foreground max-w-prose">
        {confirmed
          ? `If something here is not right, telephone ${home.name} and they will put it right.`
          : `Nothing is ordered from this page. ${home.name} will go through what you have chosen with you before anything is arranged.`}
      </p>
    </div>
  );
}

function Chosen({
  lines,
  totalCents,
  readOnly,
  onRemove,
}: {
  lines: MerchandiseSelectionLine[];
  totalCents: number;
  readOnly: boolean;
  onRemove: (lineId: number) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-xl mb-3">What you have chosen</h2>

      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {line.name}
                {line.quantity > 1 && (
                  <span className="ml-1.5 text-muted-foreground">
                    × {line.quantity}
                  </span>
                )}
              </p>
              {line.kind === "family_provided" && (
                <p className="text-sm text-muted-foreground">
                  You are bringing this. There is no charge for it.
                </p>
              )}
            </div>
            <span className="shrink-0 tabular-nums">
              {line.unitPriceCents === null
                ? "—"
                : formatPrice(line.lineTotalCents)}
            </span>
            {!readOnly && line.kind !== "package_adjustment" && (
              <button
                type="button"
                onClick={() => onRemove(line.id)}
                className="min-h-11 shrink-0 px-2 text-sm text-muted-foreground underline"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
        <span className="font-medium">Total</span>
        <span className="text-lg tabular-nums">{formatPrice(totalCents)}</span>
      </div>
    </section>
  );
}

/**
 * Paying the funeral home, which is the funeral home's business and not ours.
 *
 * Absent entirely on a pre-need plan and while the arrangement is still a
 * draft. When it does appear, the address of the link is printed underneath
 * it in full: a message about money sent to a bereaved family is the exact
 * shape of a scam, and the only defence is being boringly, visibly theirs.
 */
function Paying({
  payment,
  homeName,
  isPlan,
}: {
  payment: PaymentHandoff | null;
  homeName: string;
  /** A pre-need plan. Nothing is owed on one and nothing is collected. */
  isPlan: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="font-display text-xl">
        {isPlan ? "Your plan, written down" : "Your statement"}
      </h2>
      <p className="text-sm text-muted-foreground max-w-prose">
        {isPlan
          ? `Everything you have asked ${homeName} to arrange, at today's prices, so that whoever reads it next knows what you wanted. Nothing is owed and nothing is being collected.`
          : "The itemised list of everything you chose, with its total. Yours to keep or print."}
      </p>
      <a
        href={familyStatementUrl}
        target="_blank"
        rel="noopener"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border
                   px-4 py-2.5 font-medium text-[var(--accent-deep)]"
      >
        <FileText className="size-4" />
        {isPlan ? "Open your plan" : "Open your statement"}
      </a>

      {payment && (
        <div className="border-t border-border pt-3 space-y-2">
          <h3 className="font-medium">Paying {homeName}</h3>
          {payment.url ? (
            <>
              <a
                href={payment.url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center rounded-lg border border-border
                           px-4 py-2.5 font-medium text-[var(--accent-deep)]"
              >
                Pay {homeName} online
              </a>
              {/*
                The host is the only thing here that may be broken
                mid-string, and it has to be: a long payment domain would
                otherwise push the card sideways on a phone. Breaking the
                sentence around it the same way turns "payment" into "paym
                ent", which reads like a fault on the one card where a
                family most needs to feel sure of what they are looking at.
              */}
              <p className="text-sm text-muted-foreground">
                That link goes to{" "}
                <span className="break-all font-medium">{payment.host}</span>,
                which is {homeName}'s own payment page. This site never takes
                payments.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {payment.phone
                ? `Please telephone ${homeName} on ${payment.phone} and they will tell you how they would like to be paid.`
                : `Please telephone ${homeName} and they will tell you how they would like to be paid.`}
            </p>
          )}
          {payment.instructions && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">
              {payment.instructions}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
