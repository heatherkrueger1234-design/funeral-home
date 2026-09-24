import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSelections,
  useUpdateSelection,
  useDeleteSelection,
  useGetQuotes,
  useUpdateQuote,
  getGetSelectionsQueryKey,
  getGetQuotesQueryKey,
  getGetHomeDashboardQueryKey,
  type VendorQuote,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, ListMusic, Loader2, Phone, X } from "lucide-react";
import { Confirm, Divider, Empty, LoadFailed, Loading } from "@/components/page";
import { formatAtHome } from "@/lib/utils";
import { useHomeZone } from "@/lib/session";

const LABELS: Record<string, string> = {
  hymn: "Hymns",
  reading: "Readings",
  music: "Music",
  pallbearer: "Pallbearers",
  eulogist: "Speaking",
  other: "Other",
};

/**
 * What the family has chosen, and the one action that matters: confirming it.
 *
 * Confirming is what puts an entry into the order of service at the printer,
 * and it is also what stops the family removing it from under you.
 */
export function ServicePanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const selections = useGetSelections(caseId);

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetSelectionsQueryKey(caseId),
    });

  const update = useUpdateSelection({ mutation: { onSuccess: refresh } });
  const remove = useDeleteSelection({ mutation: { onSuccess: refresh } });

  if (selections.isPending) {
    return (
      <Loading />
    );
  }

  if (selections.isError) {
    return <LoadFailed what="The service choices" onRetry={() => void selections.refetch()} />;
  }

  const rows = selections.data ?? [];
  const kinds = [...new Set(rows.map((row) => row.kind))];

  return (
    <div className="space-y-6">
      <QuoteRequests caseId={caseId} />

      {rows.length === 0 && (
        <Empty icon={ListMusic} title="Nothing chosen yet">
          Hymns, readings and bearers appear here as the family adds them from
          their own link.
        </Empty>
      )}

      {kinds.map((kind) => (
        <section key={kind} className="space-y-2">
          <h2 className="font-display text-lg">{LABELS[kind] ?? kind}</h2>
          <ul className="space-y-2">
            {rows
              .filter((row) => row.kind === kind)
              .map((row) => {
                const confirmed = row.confirmedAt !== null;

                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--elevation-1)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{row.value}</span>
                      {row.attribution && (
                        <span className="block text-sm text-muted-foreground truncate">
                          {row.attribution}
                        </span>
                      )}
                    </span>

                    <Button
                      variant={confirmed ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={confirmed}
                      onClick={() =>
                        update.mutate({
                          selectionId: row.id,
                          data: { confirmed: !confirmed },
                        })
                      }
                    >
                      <Check className="size-4" />
                      {confirmed ? "Confirmed" : "Confirm"}
                    </Button>

                    <Confirm
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground"
                          aria-label={`Remove ${row.value}`}
                        >
                          <X className="size-4" />
                        </Button>
                      }
                      title={`Remove "${row.value}"?`}
                      description="The family chose this, and it disappears from their page too. Tell them why, in a message, if they will wonder."
                      confirmLabel="Remove it"
                      cancelLabel="Keep it"
                      destructive
                      onConfirm={() => remove.mutate({ selectionId: row.id })}
                    />
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- quotes -- */

const KIND_LABELS: Record<string, string> = {
  monument: "Headstones",
  cemetery: "Cemetery",
  casket: "Caskets",
  urn: "Urns",
  clergy: "Clergy",
  celebrant: "Celebrant",
  florist: "Florist",
  musician: "Music",
  caterer: "Catering",
  transport: "Transport",
};

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Read a typed price. Blank is allowed — plenty of vendors answer "it depends
 * on the stone, call us" — but a figure that cannot be read is refused rather
 * than quietly saved as nothing.
 */
function readAmount(raw: string): number | null | "unreadable" {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return "unreadable";
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return "unreadable";
  return Math.round(value * 100);
}

/**
 * Prices the family asked for from their portal.
 *
 * The family presses one button next to a florist or a stonemason and is
 * told the home will find out for them. Until this section existed, no
 * screen in the console showed that request at all: the family waited on an
 * answer that nobody knew they were owed.
 *
 * The home relays; it does not quote. What is typed here is the vendor's own
 * figure and words, and it appears on the family's page as exactly that.
 * Recording an answer is what marks the request answered — there is no
 * separate status to forget to change.
 */
function QuoteRequests({ caseId }: { caseId: number }) {
  const quotes = useGetQuotes(caseId);

  // Quiet when there is nothing: most families never ask, and an empty
  // heading on every case would be noise above the order of service.
  if (quotes.isPending || !quotes.data || quotes.data.length === 0) return null;

  const waiting = quotes.data.filter((quote) => quote.respondedAt === null);

  return (
    <section className="space-y-3">
      <Divider label="Prices the family asked for" />
      <p className="max-w-prose text-sm leading-snug text-muted-foreground">
        {waiting.length === 0
          ? "Every one has an answer. The family can see them on their page."
          : "Ask the vendor, then write down what they said. The family sees it on their page as the vendor's own price, never yours."}
      </p>
      <ul className="space-y-2">
        {quotes.data.map((quote) => (
          <QuoteRow key={quote.id} caseId={caseId} quote={quote} />
        ))}
      </ul>
    </section>
  );
}

function QuoteRow({ caseId, quote }: { caseId: number; quote: VendorQuote }) {
  const zone = useHomeZone();
  const queryClient = useQueryClient();
  const answered = quote.respondedAt !== null;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(
    quote.quotedAmountCents === null
      ? ""
      : (quote.quotedAmountCents / 100).toFixed(2),
  );
  const [response, setResponse] = useState(quote.response ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = useUpdateQuote({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        void queryClient.invalidateQueries({
          queryKey: getGetQuotesQueryKey(caseId),
        });
        // The dashboard counts unanswered requests; this just answered one.
        void queryClient.invalidateQueries({
          queryKey: getGetHomeDashboardQueryKey(),
        });
      },
    },
  });

  const asked = formatAtHome(quote.createdAt, zone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const status = answered
    ? quote.status === "declined"
      ? "They couldn't help"
      : "Answered"
    : quote.status === "passed_on"
      ? "You've asked them"
      : "Not asked yet";

  return (
    <li className="space-y-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-[var(--elevation-1)]">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">
            {quote.vendorName}
            <span className="font-normal text-muted-foreground">
              {" "}
              · {KIND_LABELS[quote.vendorKind] ?? "Vendor"}
            </span>
          </span>
          <span className="block text-sm text-muted-foreground">
            Asked {asked}
            {quote.requestedByName ? ` by ${quote.requestedByName}` : ""}
            {" · "}
            {status}
          </span>
        </span>
        {quote.vendorPhone && (
          <a
            href={`tel:${quote.vendorPhone.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-1 text-sm text-[var(--accent-deep)]"
          >
            <Phone className="size-3.5" />
            {quote.vendorPhone}
          </a>
        )}
      </div>

      {quote.request && (
        <p className="whitespace-pre-wrap border-l-2 border-[var(--accent)]/30 pl-3 text-sm">
          {quote.request}
        </p>
      )}

      {answered && !open && (
        <p className="rounded-lg bg-[var(--sunken)] px-3 py-2 text-sm">
          {quote.quotedAmountCents !== null && (
            <span className="tabular font-semibold">
              {money(quote.quotedAmountCents)}
              {quote.response ? " — " : ""}
            </span>
          )}
          {quote.response}
        </p>
      )}

      {open ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const cents = readAmount(amount);
            if (cents === "unreadable") {
              setProblem("That price doesn't read as an amount — try 1250 or 1,250.00.");
              return;
            }
            const text = response.trim();
            if (cents === null && !text) {
              setProblem("Write down a price, what they said, or both.");
              return;
            }
            setProblem(null);
            save.mutate({
              quoteId: quote.id,
              data: {
                quotedAmountCents: cents,
                response: text || null,
                status: "quoted",
              },
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor={`quote-${quote.id}-amount`}>Their price</Label>
              <Input
                id={`quote-${quote.id}-amount`}
                inputMode="decimal"
                className="tabular-nums"
                placeholder="Optional"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`quote-${quote.id}-response`}>What they said</Label>
              <Textarea
                id={`quote-${quote.id}-response`}
                rows={2}
                placeholder="Grey granite, double width, about six weeks. Includes the first inscription."
                value={response}
                onChange={(event) => setResponse(event.target.value)}
              />
            </div>
          </div>
          {problem && (
            <p className="text-sm text-[var(--notice)]" role="alert">
              {problem}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Show the family
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setProblem(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {answered ? "Change the answer" : "Record their answer"}
          </Button>
          {/* So whoever picks the case up tomorrow knows the call was made
              and does not ring the stonemason a second time. */}
          {quote.status === "requested" && !answered && (
            <Button
              variant="ghost"
              size="sm"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ quoteId: quote.id, data: { status: "passed_on" } })
              }
            >
              I've asked them
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
