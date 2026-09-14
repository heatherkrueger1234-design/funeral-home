import { useState } from "react";
import {
  useCaseStatements,
  useStatementWrites,
  statementPrintUrl,
  type StatementJson,
  type StatementLineInput,
  type StatementLineJson,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Printer, X } from "lucide-react";

/**
 * The Statement of Funeral Goods and Services Selected, from the desk.
 *
 * The document the FTC Funeral Rule requires a provider to give a family at
 * the end of the arrangement: itemised, totalled, and carrying the reason for
 * anything a law or a cemetery obliges them to buy.
 *
 * **Nothing here takes a payment.** There is no card field, no processor and
 * no charge — a confirmed statement produces a printable document and a link
 * to the home's *own* payment page, set once under Settings. Marking one
 * settled is a note about the home's books, which is why the button says
 * settled and the copy says "in your records": we are not told about payments
 * and must never look as though we were.
 */

const KINDS: ReadonlyArray<{
  value: StatementLineJson["kind"];
  label: string;
  hint: string;
}> = [
  {
    value: "service",
    label: "Service",
    hint: "Your professional services, transfer, care, use of facilities.",
  },
  {
    value: "merchandise",
    label: "Merchandise",
    hint: "Casket, urn, outer burial container, register book.",
  },
  {
    value: "cash_advance",
    label: "Paid on their behalf",
    hint: "Certified copies, clergy, cemetery charges, notices.",
  },
  {
    value: "family_provided",
    label: "The family brought their own",
    hint: "No charge, and none can be added — the Funeral Rule forbids it.",
  },
  {
    value: "allowance",
    label: "Allowance",
    hint: "A discount you are absorbing. Taken off the total.",
  },
];

const HEADINGS: Record<StatementLineJson["kind"], string> = {
  service: "Services",
  merchandise: "Merchandise",
  cash_advance: "Paid on their behalf",
  family_provided: "Provided by the family",
  allowance: "Allowances",
};

/**
 * Dollars typed by a person into whole cents, without going through a float.
 *
 * `Math.round(12.95 * 100)` is fine and `1.005 * 100` is not, and a statement
 * is the last document in this product where a cent should be allowed to go
 * missing. So the string is split on its own decimal point instead.
 */
function toCents(raw: string): number | null {
  const match = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;

  const cents = (match[2] ?? "").padEnd(2, "0");
  return Number(match[1]) * 100 + Number(cents);
}

const toDollars = (cents: number) => (cents / 100).toFixed(2);

function AddLine({
  statementId,
  onAdd,
  busy,
}: {
  statementId: number;
  onAdd: (input: { statementId: number; line: StatementLineInput }) => void;
  busy: boolean;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<StatementLineJson["kind"]>("service");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [disclosure, setDisclosure] = useState("");

  const unpriced = kind === "family_provided";
  const hint = KINDS.find((entry) => entry.value === kind)?.hint ?? "";

  const submit = () => {
    const trimmed = description.trim();
    if (!trimmed) {
      toast({ title: "What is the item?", variant: "destructive" });
      return;
    }

    const cents = unpriced ? 0 : toCents(amount || "0");
    if (cents === null) {
      toast({
        title: "That price didn't read as an amount",
        description: "Write it in dollars, like 2495 or 2495.00.",
        variant: "destructive",
      });
      return;
    }

    onAdd({
      statementId,
      line: {
        kind,
        description: trimmed,
        quantity: unpriced ? 1 : Math.max(1, Number(quantity) || 1),
        unitAmountCents: cents,
        disclosure: disclosure.trim() || null,
      },
    });

    setDescription("");
    setAmount("");
    setQuantity("1");
    setDisclosure("");
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="line-kind">Kind</Label>
          <Select
            value={kind}
            onValueChange={(value) =>
              setKind(value as StatementLineJson["kind"])
            }
          >
            <SelectTrigger id="line-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="line-description">Item</Label>
          <Input
            id="line-description"
            value={description}
            placeholder="Professional services of the funeral director and staff"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{hint}</p>

      {!unpriced && (
        <div className="grid gap-3 sm:grid-cols-[10rem_8rem]">
          <div className="space-y-1.5">
            <Label htmlFor="line-amount">Price, each</Label>
            <Input
              id="line-amount"
              inputMode="decimal"
              value={amount}
              placeholder="2495.00"
              className="tabular-nums"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line-quantity">How many</Label>
            <Input
              id="line-quantity"
              inputMode="numeric"
              value={quantity}
              className="tabular-nums"
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="line-disclosure">
          Why it is required, if it is
        </Label>
        <Input
          id="line-disclosure"
          value={disclosure}
          placeholder="Green Mountain Cemetery requires an outer burial container."
          onChange={(event) => setDisclosure(event.target.value)}
        />
        {/*
          The Funeral Rule wants the specific law, cemetery or crematory
          requirement written beside the item it obliges. We do not supply the
          wording: a national vendor drafting a provider's own disclosures is
          a vendor handing every home somebody else's liability.
        */}
        <p className="text-xs text-muted-foreground">
          Printed under the item. In your own words, and only where a law, a
          cemetery or a crematory actually requires it.
        </p>
      </div>

      <Button onClick={submit} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Add it
      </Button>
    </div>
  );
}

function Lines({
  statement,
  editable,
  onRemove,
}: {
  statement: StatementJson;
  editable: boolean;
  onRemove: (lineId: number) => void;
}) {
  if (statement.lines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">
        Nothing on it yet. Add what the family chose below.
      </p>
    );
  }

  const kinds = [...new Set(statement.lines.map((line) => line.kind))];

  return (
    <div className="rounded-xl border border-border bg-card px-4">
      {kinds.map((kind) => (
        <section key={kind} className="py-2">
          <h3 className="pt-2 text-xs uppercase tracking-wide text-muted-foreground">
            {HEADINGS[kind]}
          </h3>
          <ul>
            {statement.lines
              .filter((line) => line.kind === kind)
              .map((line) => (
                <li
                  key={line.id}
                  className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p>{line.description}</p>
                    {line.detail && (
                      <p className="text-sm text-muted-foreground">
                        {line.detail}
                      </p>
                    )}
                    {line.quantity > 1 && line.amount !== null && (
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {line.quantity} × ${toDollars(line.unitAmountCents)}
                      </p>
                    )}
                    {line.disclosure && (
                      <p className="text-sm text-muted-foreground">
                        {line.disclosure}
                      </p>
                    )}
                  </div>

                  <p className="shrink-0 tabular-nums">
                    {line.amount ?? (
                      <span className="text-muted-foreground">No charge</span>
                    )}
                  </p>

                  {editable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${line.description}`}
                      className="text-muted-foreground"
                      onClick={() => onRemove(line.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      <div className="flex items-baseline justify-between border-t-2 border-[var(--accent)] py-3">
        <p className="font-medium">Total</p>
        <p className="font-display text-xl tabular-nums">{statement.total}</p>
      </div>
    </div>
  );
}

export function StatementPanel({ caseId }: { caseId: number }) {
  const statements = useCaseStatements(caseId);
  const writes = useStatementWrites(caseId);
  const { toast } = useToast();
  const [settledNote, setSettledNote] = useState("");

  if (statements.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = statements.data ?? [];
  const draft = rows.find((row) => row.status === "draft") ?? null;
  const confirmed = rows.find((row) => row.status === "confirmed") ?? null;
  const superseded = rows.filter((row) => row.status === "superseded");

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground">
          The Funeral Rule asks you to give the family an itemised statement at
          the end of the arrangement. Start it here and it prints on your
          letterhead.
        </p>
        <Button
          onClick={() => writes.start.mutate()}
          disabled={writes.start.isPending}
        >
          {writes.start.isPending && <Loader2 className="size-4 animate-spin" />}
          Start the statement
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {draft && (
        <section className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                {draft.version > 1 ? `Revision ${draft.version}` : "In progress"}
              </h2>
              <p className="text-sm text-muted-foreground">
                The family sees nothing until you confirm it.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <a
                  href={statementPrintUrl(draft.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer className="size-4" />
                  Read it through
                </a>
              </Button>
              <Button
                disabled={
                  draft.lines.length === 0 || writes.confirm.isPending
                }
                onClick={() =>
                  writes.confirm.mutate(draft.id, {
                    onSuccess: () =>
                      toast({
                        title: "Confirmed",
                        description:
                          "The family can see it and print their own copy. It cannot be edited now — a change means a revision.",
                      }),
                  })
                }
              >
                {writes.confirm.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Confirm it
              </Button>
            </div>
          </header>

          <Lines
            statement={draft}
            editable
            onRemove={(lineId) => writes.removeLine.mutate(lineId)}
          />

          <AddLine
            statementId={draft.id}
            busy={writes.addLine.isPending}
            onAdd={(input) => writes.addLine.mutate(input)}
          />

          <div className="space-y-1.5">
            <Label htmlFor="statement-notes">Anything to add at the foot</Label>
            <Textarea
              id="statement-notes"
              defaultValue={draft.notes ?? ""}
              rows={3}
              onBlur={(event) =>
                writes.updateStatement.mutate({
                  statementId: draft.id,
                  values: { notes: event.target.value.trim() || null },
                })
              }
            />
          </div>
        </section>
      )}

      {confirmed && (
        <section className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">
                Given to the family
                {confirmed.version > 1 ? ` · revision ${confirmed.version}` : ""}
              </h2>
              <p className="text-sm text-muted-foreground">
                {confirmed.settledAt === null
                  ? "They can see this and print their own copy."
                  : "Marked settled in your records."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <a
                  href={statementPrintUrl(confirmed.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Printer className="size-4" />
                  Print
                </a>
              </Button>
              {!draft && (
                <Button
                  variant="outline"
                  onClick={() => writes.start.mutate()}
                  disabled={writes.start.isPending}
                >
                  Start a revision
                </Button>
              )}
            </div>
          </header>

          {/*
            While a revision is open, the confirmed copy collapses to its
            total. The same thirty lines twice down one page is how a director
            edits the wrong one.
          */}
          {draft ? (
            <div className="flex items-baseline justify-between rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-muted-foreground">
                {confirmed.lines.length} item
                {confirmed.lines.length === 1 ? "" : "s"}
              </p>
              <p className="tabular-nums">{confirmed.total}</p>
            </div>
          ) : (
            <Lines statement={confirmed} editable={false} onRemove={() => {}} />
          )}

          {/*
            Settled is a note about the home's own books. We do not process the
            payment and are never told about one, so nothing here says "paid"
            and nothing here is a receipt.
          */}
          {confirmed.settledAt === null ? (
            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              <Label htmlFor="settled-note">
                Mark it settled in your records
              </Label>
              <Input
                id="settled-note"
                value={settledNote}
                placeholder="Check 4417, banked 14 March"
                onChange={(event) => setSettledNote(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This is your note, from your own books. We take no payments and
                are never told when one arrives, so nothing here confirms
                anything on your behalf.
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  writes.markSettled.mutate({
                    statementId: confirmed.id,
                    note: settledNote.trim() || null,
                  })
                }
              >
                Mark settled
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
              <p className="min-w-0 flex-1">
                Settled in your records
                {confirmed.settledNote ? ` — ${confirmed.settledNote}` : "."}
              </p>
              <Button
                variant="ghost"
                onClick={() => writes.clearSettled.mutate(confirmed.id)}
              >
                Undo that
              </Button>
            </div>
          )}
        </section>
      )}

      {superseded.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium">Earlier versions</h2>
          <p className="text-sm text-muted-foreground">
            Kept as they were given. A statement a family was handed is a
            record, so it is never edited or removed.
          </p>
          <ul className="space-y-2">
            {superseded.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  Revision {row.version}
                  <span className="ml-2 text-muted-foreground tabular-nums">
                    {row.total}
                  </span>
                </span>
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={statementPrintUrl(row.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Printer className="size-4" />
                    Open
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
