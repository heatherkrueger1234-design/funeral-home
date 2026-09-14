import { useRef, useState } from "react";
import { Redirect } from "wouter";
import {
  useFamilyStatement,
  useGetFamilySession,
  getFamilyStatementHtml,
  type PaymentHandoffJson,
  type StatementJson,
  type StatementLineJson,
} from "@workspace/api-client-react";
import { ExternalLink, Loader2, Printer } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * The statement, and where to go to settle it.
 *
 * Read this before changing anything on this screen.
 *
 * **We do not take the money.** This product processes no payments, holds no
 * funds and stores no card details. What this page does is show the family
 * what their funeral director itemised, and then point at the home's own
 * payment page — the home's website, the home's processor, the home's
 * merchant account. Nothing here may suggest we received, confirmed or know
 * anything about a payment, because we did not and do not.
 *
 * It is also the page a scammer would most like to imitate: a message about
 * money, arriving beside a death notice, to somebody who is not thinking
 * clearly. So it is deliberately dull. The home's name and its web address are
 * said out loud beside the link, there is no countdown, no "act now", no
 * styled urgency, and the telephone number is always there for a family who
 * would rather talk to a person — which, at this moment in their life, plenty
 * of them would.
 *
 * A pre-need file never reaches here at all. See the redirect below.
 */

const SECTIONS: ReadonlyArray<{
  kind: StatementLineJson["kind"];
  heading: string;
  note: string | null;
}> = [
  { kind: "service", heading: "Services", note: null },
  { kind: "merchandise", heading: "Merchandise", note: null },
  {
    kind: "cash_advance",
    heading: "Paid on your behalf",
    note: "Things the funeral home paid somebody else for, on your behalf.",
  },
  {
    kind: "family_provided",
    heading: "Provided by you",
    note: "Brought in by your family. There is no charge for handling it.",
  },
  { kind: "allowance", heading: "Allowances", note: null },
];

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Line({ line }: { line: StatementLineJson }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p>{line.description}</p>
        {line.detail && (
          <p className="text-sm text-muted-foreground">{line.detail}</p>
        )}
        {line.quantity > 1 && line.amount !== null && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {line.quantity} × ${(line.unitAmountCents / 100).toFixed(2)}
          </p>
        )}
        {/*
          The Funeral Rule requires the reason an item is required to sit with
          the item. It reads as a plain sentence, not a warning, because that
          is what it is: the cemetery asks for a container, and here is the
          line that says so.
        */}
        {line.disclosure && (
          <p className="mt-1 text-sm text-muted-foreground">{line.disclosure}</p>
        )}
      </div>
      <p className="shrink-0 tabular-nums text-right">
        {line.amount ?? (
          <span className="text-muted-foreground">No charge</span>
        )}
      </p>
    </li>
  );
}

/**
 * Where to send the money, said plainly.
 *
 * The destination is shown as text beside the link rather than hidden behind
 * it. A family should be able to decide this is genuine without clicking, and
 * the fastest way to make that possible is to name the home and show the web
 * address they already know.
 */
function Settling({
  payment,
  homeName,
}: {
  payment: PaymentHandoffJson;
  homeName: string;
}) {
  const somewhereToGo =
    payment.url !== null ||
    Boolean(payment.otherWaysToPay?.trim()) ||
    payment.phone !== null;

  if (!somewhereToGo) {
    // Nothing set up, and no error shown for it. The family did nothing
    // wrong, and "contact your funeral home" is the true next step anyway.
    return (
      <section className="rounded-xl border border-border bg-card px-4 py-4">
        <h2 className="font-display text-lg mb-1">Settling this</h2>
        <p className="text-muted-foreground">
          Please speak to {homeName} about settling this. They will talk you
          through how they would like it done.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card px-4 py-4 space-y-3">
      <h2 className="font-display text-lg">Settling this</h2>

      {payment.url !== null && (
        <div>
          <a
            href={payment.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-left text-white [text-wrap:balance]"
          >
            <ExternalLink className="size-4 shrink-0" />
            {/*
              The home's name is inside the button, not only beside it. A
              family should be able to tell this is their funeral director
              without reading the small print under it, because on the day
              they read this they will not read the small print.
            */}
            Pay on {homeName}'s website
          </a>
          <p className="mt-2 text-sm text-muted-foreground">
            This opens {payment.host ?? payment.url} — {homeName}'s own website.
            Payment is handled there, by them. We never take a payment and never
            see your card details.
          </p>
        </div>
      )}

      {payment.otherWaysToPay?.trim() && (
        <p className="whitespace-pre-line">{payment.otherWaysToPay.trim()}</p>
      )}

      {payment.phone && (
        <p>
          Or telephone {homeName} on{" "}
          <a href={`tel:${payment.phone}`} className="underline">
            {payment.phone}
          </a>
          , and they will take it from there.
        </p>
      )}
    </section>
  );
}

export default function Statement() {
  const session = useGetFamilySession();
  const statement = useFamilyStatement();

  /*
   * The printable copy is fetched rather than linked, because the family's
   * credential is a bearer token and a browser will not put a header on an
   * iframe. The markup goes into a hidden frame and that frame is printed —
   * which is also how a family saves it as a PDF and keeps it, off this site,
   * without an account.
   */
  const frame = useRef<HTMLIFrameElement>(null);
  const [printing, setPrinting] = useState(false);

  const printCopy = async () => {
    setPrinting(true);
    try {
      const html = await getFamilyStatementHtml();
      const node = frame.current;
      if (!node) return;

      // Cleared only once the frame has actually loaded, not when the fetch
      // resolves — otherwise the button says it is finished while the print
      // dialogue has not opened yet.
      node.onload = () => {
        setPrinting(false);
        node.contentWindow?.focus();
        node.contentWindow?.print();
      };
      node.srcdoc = html;
    } catch {
      setPrinting(false);
      toast({
        title: "That didn't open",
        description:
          "Please try again in a moment, or ask your funeral director for a copy.",
        variant: "destructive",
      });
    }
  };

  if (session.isPending || statement.isPending) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-48 rounded bg-muted animate-pulse" />
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  const home = session.data?.home;

  /*
   * Somebody arranging their own funeral in advance never sees this screen.
   *
   * A total plus a way to pay it, put in front of a living person planning
   * ahead, is a preneed contract — and selling one in Colorado needs a
   * Division of Insurance licence, $100,000 of net worth or a bond, and 85% of
   * the money in trust (C.R.S. Title 10, Article 15). The plan is recorded
   * here; the money is not discussed here. There is no link to this page on a
   * pre-need file, and reaching it by typing the address goes home.
   */
  if (session.data?.case.kind === "pre_need") {
    return <Redirect to="/" replace />;
  }

  const row: StatementJson | null = statement.data?.statement ?? null;
  const payment = statement.data?.payment ?? null;
  const homeName = home?.name ?? "the funeral home";

  if (row === null) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl mb-1">The statement</h1>
        </header>
        <p className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-muted-foreground">
          {homeName} is still putting this together. They will let you know when
          it is ready, and it will appear here.
        </p>
        {home?.phone && (
          <p className="text-muted-foreground">
            If you would like to ask about it, telephone {homeName} on{" "}
            <a href={`tel:${home.phone}`} className="underline">
              {home.phone}
            </a>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl mb-1">The statement</h1>
        <p className="text-muted-foreground">
          What you chose, itemised, from {homeName}.
          {row.confirmedAt ? ` Dated ${formatDate(row.confirmedAt)}.` : ""}
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card px-4 py-2">
        {SECTIONS.map((section) => {
          const lines = row.lines.filter((line) => line.kind === section.kind);
          if (lines.length === 0) return null;

          return (
            <div key={section.kind} className="py-2">
              <h2 className="text-xs uppercase tracking-wide text-[var(--accent-deep)] pt-2">
                {section.heading}
              </h2>
              {section.note && (
                <p className="text-sm text-muted-foreground">{section.note}</p>
              )}
              <ul className="mt-1">
                {lines.map((line) => (
                  <Line key={line.id} line={line} />
                ))}
              </ul>
            </div>
          );
        })}

        <div className="flex items-baseline justify-between gap-4 border-t-2 border-[var(--accent)] py-4">
          <p className="font-display text-lg">Total</p>
          <p className="font-display text-2xl tabular-nums">{row.total}</p>
        </div>
      </section>

      {row.notes && (
        <p className="whitespace-pre-line text-muted-foreground max-w-prose">
          {row.notes}
        </p>
      )}

      {/*
        A note about the home's books, worded so that it cannot be read as a
        receipt from us. We are not part of the payment and are never told
        about one.
      */}
      {row.settledAt !== null && (
        <p className="rounded-xl border border-border bg-[var(--accent-soft)] px-4 py-3">
          {homeName} has marked this settled in their own records
          {row.settledNote ? ` — ${row.settledNote}` : "."}
        </p>
      )}

      {payment !== null && row.settledAt === null && (
        <Settling payment={payment} homeName={homeName} />
      )}

      <div>
        <button
          type="button"
          onClick={() => void printCopy()}
          disabled={printing}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2.5"
        >
          {printing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Printer className="size-4" />
          )}
          Print or save a copy
        </button>
        <p className="mt-2 text-sm text-muted-foreground max-w-prose">
          Yours to keep. Save it as a PDF from the print dialogue if you would
          rather have it on your own computer.
        </p>
      </div>

      <iframe ref={frame} title="Statement for printing" className="hidden" />
    </div>
  );
}
