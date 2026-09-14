import {
  decedentDisplayName,
  formatUsd,
  isUnpricedKind,
  lineSubtotalCents,
  statementTotalCents,
  STATEMENT_SECTIONS,
  type Case,
  type FuneralHome,
  type StatementLine,
} from "@workspace/db";
import { esc } from "./print-render";
import type { PaymentHandoffJson, StatementWithLines } from "./statement";

/**
 * The Statement of Funeral Goods and Services Selected, as a printed page.
 *
 * This is the legal artifact of the whole component. The FTC Funeral Rule
 * requires a funeral provider to give the family an itemised written
 * statement at the end of the arrangement conference showing the goods and
 * services selected, the price of each, the total, and — where an item is
 * only being bought because a law or a cemetery insists on it — the
 * requirement that makes it necessary.
 *
 * Two decisions worth stating outright:
 *
 *  1. **Our name is not on it.** The funeral provider is the home. This
 *     document is theirs, on their letterhead, and a software vendor's mark
 *     in the footer would be a vendor putting itself on a provider's Funeral
 *     Rule disclosure. There is nothing to gain and a great deal to explain.
 *
 *  2. **HTML at a real page size, not a PDF built here.** The same reasoning
 *     as `print-render.ts`: every browser already has a competent PDF writer
 *     behind Ctrl-P, a director can read it before committing, and it can be
 *     emailed as it stands. `@page` is US Letter because that is what is in
 *     the tray in Longmont.
 */

export type StatementRenderInput = {
  statement: StatementWithLines;
  case: Case;
  home: FuneralHome;
  /**
   * How the home takes payment. Printed as plainly as it is shown on screen,
   * and omitted entirely when the home has set nothing up — a blank "pay
   * here" box on a statement is worse than no box.
   */
  handoff: PaymentHandoffJson;
};

/** Long-form date, the way a document is dated rather than a log line. */
function formatDate(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function homeAddress(home: FuneralHome): string {
  const street = [home.addressLine1, home.addressLine2]
    .filter((part) => part && part.trim() !== "")
    .join(", ");
  const town = [home.city, home.region].filter(Boolean).join(", ");
  const line = [town, home.postalCode].filter(Boolean).join(" ");

  return [street, line].filter((part) => part !== "").join(" · ");
}

function lineRow(line: StatementLine): string {
  const unpriced = isUnpricedKind(line.kind);
  const amount = unpriced ? "No charge" : formatUsd(lineSubtotalCents(line));

  const detail = line.detail?.trim()
    ? `<div class="detail">${esc(line.detail.trim())}</div>`
    : "";

  /*
   * The required-purchase sentence sits under the item it belongs to rather
   * than in a block at the foot. A family reading "Outer burial container —
   * $1,195" needs "Green Mountain Cemetery requires a container" on the same
   * line of sight, not forty lines down under a heading nobody reads.
   */
  const disclosure = line.disclosure?.trim()
    ? `<div class="disclosure">${esc(line.disclosure.trim())}</div>`
    : "";

  const quantity =
    line.quantity > 1 && !unpriced
      ? `<div class="detail">${line.quantity} × ${esc(formatUsd(line.unitAmountCents))}</div>`
      : "";

  return `<tr>
      <td class="item">
        <div class="description">${esc(line.description)}</div>
        ${detail}${quantity}${disclosure}
      </td>
      <td class="amount${unpriced ? " amount--none" : ""}">${esc(amount)}</td>
    </tr>`;
}

function section(
  heading: string,
  note: string | null,
  lines: StatementLine[],
): string {
  if (lines.length === 0) return "";

  const caption = note
    ? `<p class="section-note">${esc(note)}</p>`
    : "";

  return `<section class="section">
    <h2>${esc(heading)}</h2>
    ${caption}
    <table>
      <tbody>${lines.map(lineRow).join("")}</tbody>
    </table>
  </section>`;
}

/**
 * The note about the home's records — not a receipt, and it has to read like
 * one sentence of bookkeeping rather than a confirmation of anything.
 */
function settledBlock(input: StatementRenderInput): string {
  const { statement, home } = input;
  if (statement.settledAt === null) return "";

  const note = statement.settledNote?.trim()
    ? ` ${esc(statement.settledNote.trim())}`
    : "";

  return `<p class="settled">${esc(home.name)} recorded this as settled in their own records on ${esc(formatDate(statement.settledAt))}.${note}</p>`;
}

/**
 * How to pay, in the home's words, pointing at the home's own page.
 *
 * No total is repeated here and no button is drawn. A family reads the figure
 * once, above, and then reads where to take it — which is out of this product
 * altogether, to the processor the home has always used.
 */
function handoffBlock(input: StatementRenderInput): string {
  const { handoff, home } = input;

  const parts: string[] = [];

  if (handoff.url !== null) {
    const host = handoff.host ?? handoff.url;
    parts.push(
      `<p>Online, on ${esc(home.name)}'s own website: <span class="url">${esc(handoff.url)}</span> (${esc(host)})</p>`,
    );
  }

  if (handoff.otherWaysToPay?.trim()) {
    parts.push(`<p>${esc(handoff.otherWaysToPay.trim())}</p>`);
  }

  if (handoff.phone) {
    parts.push(
      `<p>Or telephone ${esc(home.name)} on ${esc(handoff.phone)} and they will take it from there.</p>`,
    );
  }

  if (parts.length === 0) return "";

  return `<section class="handoff">
    <h2>Settling this</h2>
    ${parts.join("")}
  </section>`;
}

export function renderStatement(input: StatementRenderInput): string {
  const { statement, home } = input;

  const accent = /^#[0-9a-fA-F]{6}$/.test(home.accentColor)
    ? home.accentColor
    : "#1f4e46";

  const sections = STATEMENT_SECTIONS.map((entry) =>
    section(
      entry.heading,
      entry.note,
      statement.lines.filter((line) => line.kind === entry.kind),
    ),
  ).join("");

  const total = formatUsd(statementTotalCents(statement.lines));
  const name = decedentDisplayName(input.case);
  const address = homeAddress(home);

  // A draft is watermarked rather than refused, because a director does print
  // one to read through at the desk — and a draft that cannot be told from
  // the confirmed copy is how the wrong figure ends up in a family's hands.
  const draftMark =
    statement.status === "draft"
      ? `<p class="draft">Draft — not yet confirmed</p>`
      : "";

  const reference = statement.reference?.trim()
    ? `<div><span>Reference</span>${esc(statement.reference.trim())}</div>`
    : "";

  const dated = statement.confirmedAt ?? statement.createdAt;

  const revision =
    statement.version > 1
      ? `<div><span>Revision</span>${statement.version}</div>`
      : "";

  const notes = statement.notes?.trim()
    ? `<section class="notes">${esc(statement.notes.trim())
        .split(/\r?\n/)
        .map((entry) => `<p>${entry}</p>`)
        .join("")}</section>`
      : "";

  const empty =
    statement.lines.length === 0
      ? `<p class="empty">Nothing has been selected yet.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Statement of Funeral Goods and Services Selected — ${esc(name)}</title>
<style>
  @page { size: 8.5in 11in; margin: 0.75in; }

  :root { --accent: ${accent}; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    background: #f4f2ef;
    font-size: 10.5pt;
    line-height: 1.5;
  }

  .sheet {
    width: 8.5in;
    min-height: 11in;
    padding: 0.75in;
    margin: 0 auto;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0,0,0,.14);
  }

  /* Every figure in a column a person adds up by eye. */
  .amount, .total-amount { font-variant-numeric: tabular-nums; }

  header { border-bottom: 1.5pt solid var(--accent); padding-bottom: .16in; }
  .home { font-size: 15pt; font-weight: 600; margin: 0; }
  .home-detail { font-size: 9pt; color: #555; margin: .04in 0 0; }

  h1 {
    font-size: 12pt;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--accent);
    margin: .22in 0 .06in;
  }

  .for { font-size: 13pt; margin: 0 0 .04in; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: .06in .3in;
    font-size: 9pt;
    color: #555;
    margin: .06in 0 .18in;
  }
  .meta span { display: block; font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; color: #8a8378; }

  .draft {
    display: inline-block;
    margin: .1in 0 0;
    padding: .03in .1in;
    border: 1pt solid #8a8378;
    font-size: 8.5pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #6b6b6b;
  }

  .section { margin-top: .2in; break-inside: avoid; }
  h2 {
    font-size: 9.5pt;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 .04in;
    border-bottom: .5pt solid #ddd7cd;
    padding-bottom: .03in;
  }
  .section-note { font-size: 8.5pt; color: #6b6b6b; margin: .04in 0 .02in; }

  table { width: 100%; border-collapse: collapse; }
  td { padding: .05in 0; vertical-align: top; border-bottom: .5pt solid #eee9e1; }
  .description { }
  .detail { font-size: 9pt; color: #6b6b6b; }
  .disclosure { font-size: 9pt; color: #4a4a4a; font-style: italic; margin-top: .02in; }
  .amount { text-align: right; white-space: nowrap; padding-left: .25in; width: 1.5in; }
  .amount--none { color: #6b6b6b; font-style: italic; }

  .total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: .22in;
    padding-top: .08in;
    border-top: 1.5pt solid var(--accent);
  }
  .total-label { font-size: 11pt; letter-spacing: .04em; text-transform: uppercase; }
  .total-amount { font-size: 15pt; font-weight: 600; }

  .settled { font-size: 9.5pt; color: #4a4a4a; margin: .1in 0 0; }
  .notes { margin-top: .2in; font-size: 9.5pt; }
  .notes p { margin: 0 0 .05in; }
  .empty { color: #6b6b6b; font-style: italic; }

  .handoff { margin-top: .26in; break-inside: avoid; }
  .handoff p { margin: .04in 0; font-size: 9.5pt; }
  .url { word-break: break-all; }

  @media print {
    body { background: #fff; }
    .sheet { width: auto; min-height: 0; padding: 0; margin: 0; box-shadow: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="sheet">
  <header>
    <p class="home">${esc(home.name)}</p>
    ${address === "" ? "" : `<p class="home-detail">${esc(address)}</p>`}
    ${home.phone ? `<p class="home-detail">${esc(home.phone)}</p>` : ""}
  </header>

  <h1>Statement of Funeral Goods and Services Selected</h1>
  <p class="for">${esc(name)}</p>
  <div class="meta">
    <div><span>Date</span>${esc(formatDate(dated))}</div>
    ${reference}${revision}
  </div>
  ${draftMark}

  ${sections}${empty}

  <div class="total">
    <div class="total-label">Total</div>
    <div class="total-amount">${esc(total)}</div>
  </div>
  ${settledBlock(input)}
  ${notes}
  ${handoffBlock(input)}
</div>
</body>
</html>`;
}
