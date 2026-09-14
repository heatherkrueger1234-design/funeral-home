import {
  GPL_DISCLOSURES,
  decedentDisplayName,
  formatPrice,
  lineTotalCents,
  selectionTotalCents,
  type Case,
  type CatalogueCategory,
  type CatalogueItem,
  type FuneralHome,
  type MerchandiseSelection,
  type MerchandiseSelectionItem,
  type StorefrontSettings,
} from "@workspace/db";
import { esc, lines } from "./print-render";

/**
 * The four documents the FTC Funeral Rule makes a funeral provider produce.
 *
 * Built the way the print studio builds a prayer card, and for the same
 * reasons: print-ready HTML with physical units and a `@page` rule, rather
 * than a PDF assembled in this process. The browser behind Ctrl-P writes a
 * better PDF than a library bolted on here would, a director can read it
 * before they commit, and it can be emailed to whoever prints it. `esc` and
 * `lines` are shared with `print-render.ts` so that a home's own wording is
 * escaped once, one way, everywhere it is printed.
 *
 * What is different is the page. A prayer card is a trade size with bleed; a
 * price list is a sheet of letter paper that goes in a binder on the
 * arrangement desk and gets handed across it. So: US Letter, real margins,
 * and a type size somebody in their seventies can read without turning it to
 * the light.
 *
 * Every price in these documents comes from the home. We set none of them.
 */

export type PriceListKind = "gpl" | "cpl" | "obcpl";

export type PriceListCategory = {
  category: CatalogueCategory;
  items: CatalogueItem[];
};

export type PriceListInput = {
  kind: PriceListKind;
  home: FuneralHome;
  settings: StorefrontSettings | null;
  /** Already filtered to the sections this list covers, in printed order. */
  categories: PriceListCategory[];
  logoDataUri: string | null;
};

const TITLES: Record<PriceListKind, string> = {
  gpl: "General Price List",
  cpl: "Casket Price List",
  obcpl: "Outer Burial Container Price List",
};

/**
 * What each list says it is for, under the title.
 *
 * Ours rather than the home's, because these sentences describe the document
 * itself rather than the home's terms — and because a family handed three
 * similar-looking sheets needs to be told plainly which one they are reading.
 */
const STRAPLINES: Record<PriceListKind, string> = {
  gpl: "These prices are effective as of the date below. You may choose only the items you want.",
  cpl: "The complete list of caskets we offer. You may choose only the items you want.",
  obcpl:
    "The complete list of outer burial containers we offer. You may choose only the items you want.",
};

function formatDay(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** The home's letterhead, as much of it as the home has filled in. */
function letterhead(home: FuneralHome, logoDataUri: string | null): string {
  const address = [
    home.addressLine1,
    home.addressLine2,
    [home.city, home.region, home.postalCode].filter(Boolean).join(" "),
  ]
    .filter((part) => part && part.trim() !== "")
    .map((part) => esc(part!))
    .join(" · ");

  return `<header class="letterhead">
  ${logoDataUri ? `<img class="mark" src="${logoDataUri}" alt="">` : ""}
  <div>
    <p class="home">${esc(home.name)}</p>
    ${address ? `<p class="meta">${address}</p>` : ""}
    ${home.phone ? `<p class="meta">${esc(home.phone)}</p>` : ""}
  </div>
</header>`;
}

function itemRow(item: CatalogueItem): string {
  const unit = item.priceUnit ? ` <span class="unit">${esc(item.priceUnit)}</span>` : "";
  const byRequest =
    item.availability === "by_request"
      ? `<span class="unit">ordered for you</span>`
      : "";

  return `<tr>
  <td>
    <span class="name">${esc(item.name)}</span>
    ${byRequest}
    ${item.description ? `<span class="detail">${esc(item.description)}</span>` : ""}
  </td>
  <td class="amount">${esc(formatPrice(item.priceCents))}${unit}</td>
</tr>`;
}

function categoryBlock(block: PriceListCategory): string {
  return `<section class="group">
  <h2>${esc(block.category.name)}</h2>
  ${block.category.description ? `<p class="lede">${esc(block.category.description)}</p>` : ""}
  <table>${block.items.map(itemRow).join("")}</table>
</section>`;
}

/**
 * The disclosures, in the home's own words.
 *
 * A slot the home has not written is left out of the printed sheet rather
 * than printed empty or filled in by us. The director console is where a
 * missing one is raised, before anything is handed to a family — a price
 * list carrying a paragraph of ours over a home's signature would be the
 * wrong kind of helpful.
 */
function disclosureBlock(settings: StorefrontSettings | null): string {
  const written = (settings?.disclosures ?? {}) as Record<string, unknown>;

  const blocks = GPL_DISCLOSURES.map((slot) => {
    const value = written[slot.key];
    if (typeof value !== "string" || value.trim() === "") return "";
    return `<div class="disclosure"><p class="disclosure-title">${esc(slot.title)}</p><div>${lines(value)}</div></div>`;
  }).filter(Boolean);

  if (blocks.length === 0) return "";

  return `<section class="disclosures">${blocks.join("")}</section>`;
}

/**
 * One stylesheet for all four documents.
 *
 * `tabular-nums` on the amounts is not decoration: a column of prices that
 * does not line up is the first thing that makes a printed sheet look like
 * it came out of a word processor at the last minute.
 */
function documentCss(accent: string): string {
  return `
  @page { size: 8.5in 11in; margin: 0.75in 0.8in; }

  :root { --accent: ${accent}; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    background: #fff;
    font-size: 11pt;
    line-height: 1.45;
  }

  .sheet { max-width: 6.9in; margin: 0 auto; padding: 0.4in 0; }

  .letterhead {
    display: flex;
    align-items: center;
    gap: 0.18in;
    border-bottom: 1.5pt solid var(--accent);
    padding-bottom: 0.12in;
  }
  .letterhead .mark { max-height: 0.6in; max-width: 1.4in; }
  .home { font-size: 14pt; margin: 0; letter-spacing: .01em; }
  .meta { font-size: 9pt; color: #555; margin: 0.02in 0 0; }

  h1 {
    font-size: 17pt;
    margin: 0.22in 0 0.04in;
    color: var(--accent);
  }
  .strapline { margin: 0 0 0.04in; font-size: 10pt; }
  .effective { margin: 0; font-size: 9.5pt; color: #555; }

  h2 {
    font-size: 10pt;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 0.04in;
    border-bottom: 0.5pt solid #d9d4cc;
    padding-bottom: 0.03in;
  }

  .group { margin-top: 0.26in; break-inside: avoid; }
  .lede { font-size: 9.5pt; color: #555; margin: 0 0 0.06in; }

  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.055in 0; vertical-align: top; border-bottom: 0.5pt solid #efece7; }
  tr:last-child td { border-bottom: none; }

  .name { font-weight: 600; }
  .detail, .unit { display: block; font-size: 9pt; color: #555; }

  .amount {
    text-align: right;
    white-space: nowrap;
    width: 1.5in;
    font-variant-numeric: tabular-nums;
  }
  .amount .unit { display: block; }

  .disclosures { margin-top: 0.3in; break-inside: avoid; }
  .disclosure { margin-bottom: 0.14in; font-size: 9.5pt; }
  .disclosure-title { font-weight: 600; margin: 0 0 0.02in; }

  .footnote {
    margin-top: 0.3in;
    padding-top: 0.1in;
    border-top: 0.5pt solid #d9d4cc;
    font-size: 9pt;
    color: #555;
  }

  .empty {
    margin-top: 0.3in;
    font-size: 10pt;
    color: #555;
  }

  @media print {
    .sheet { padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;
}

function accentOf(home: FuneralHome): string {
  return /^#[0-9a-fA-F]{6}$/.test(home.accentColor) ? home.accentColor : "#1f4e46";
}

function documentShell(options: {
  title: string;
  accent: string;
  extraCss?: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(options.title)}</title>
<style>${documentCss(options.accent)}${options.extraCss ?? ""}</style>
</head>
<body>
<div class="sheet">
${options.body}
</div>
</body>
</html>`;
}

export function renderPriceList(input: PriceListInput): string {
  const { home, settings, kind } = input;
  const effective = formatDay(settings?.gplEffectiveOn ?? null);

  const body = [
    letterhead(home, input.logoDataUri),
    `<h1>${esc(TITLES[kind])}</h1>`,
    `<p class="strapline">${esc(STRAPLINES[kind])}</p>`,
    effective
      ? `<p class="effective">Effective ${esc(effective)}.</p>`
      : "",
    input.categories.length === 0
      ? `<p class="empty">There is nothing in this list yet.</p>`
      : input.categories.map(categoryBlock).join(""),
    // The disclosures belong on the General Price List. A Casket Price List
    // is a list of caskets and their prices, and padding it with paragraphs
    // from the GPL only makes the sheet harder to compare against the one
    // from the home down the road.
    kind === "gpl" ? disclosureBlock(settings) : "",
    settings?.priceListFootnote
      ? `<div class="footnote">${lines(settings.priceListFootnote)}</div>`
      : "",
  ].join("\n");

  return documentShell({
    title: `${home.name} — ${TITLES[kind]}`,
    accent: accentOf(home),
    body,
  });
}

/* ----------------------------------------------------------- statement -- */

export type StatementInput = {
  home: FuneralHome;
  case: Case;
  settings: StorefrontSettings | null;
  selection: MerchandiseSelection;
  lines: MerchandiseSelectionItem[];
  logoDataUri: string | null;
};

const STATEMENT_CSS = `
  .subject { margin: 0.18in 0 0; font-size: 10.5pt; }
  .subject strong { font-size: 12pt; }

  .line-note { display: block; font-size: 9pt; color: #555; font-style: italic; }
  .qty { font-size: 9pt; color: #555; }

  .no-charge { color: #555; font-style: italic; }

  .total td {
    border-top: 1pt solid var(--accent);
    border-bottom: none;
    padding-top: 0.08in;
    font-size: 12pt;
    font-weight: 600;
  }

  .paying {
    margin-top: 0.34in;
    padding: 0.16in 0.18in;
    border: 0.75pt solid #d9d4cc;
    font-size: 10pt;
    break-inside: avoid;
  }
  .paying h2 { border: none; margin-bottom: 0.06in; }
  .paying p { margin: 0 0 0.06in; }
  .paying .destination { font-family: ui-monospace, "SFMono-Regular", Menlo, monospace; font-size: 9pt; word-break: break-all; }
`;

/**
 * A line as the statement prints it.
 *
 * Every line carries its own price, including the ones that came in as part
 * of a package — the package's own price appears once, as an adjustment, so
 * that a family can see both what each thing costs and what the set saved
 * them. That is the shape the Funeral Rule asks for and, as it happens, the
 * shape somebody checking a bill against their memory of the conversation
 * can actually follow.
 */
function statementRow(line: MerchandiseSelectionItem): string {
  const quantity =
    line.quantity > 1 ? ` <span class="qty">× ${line.quantity}</span>` : "";

  const amount =
    line.kind === "family_provided"
      ? `<span class="no-charge">No charge</span>`
      : esc(formatPrice(lineTotalCents(line)));

  return `<tr>
  <td>
    <span class="name">${esc(line.name)}</span>${quantity}
    ${line.description ? `<span class="detail">${esc(line.description)}</span>` : ""}
    ${line.notes ? `<span class="line-note">${esc(line.notes)}</span>` : ""}
  </td>
  <td class="amount">${amount}</td>
</tr>`;
}

/**
 * Where to send the money, which is never here.
 *
 * Three states, and all three are answers rather than errors. A home with a
 * payment page gets a link with the destination printed under it in full,
 * because a message about money sent to a bereaved family is precisely what
 * a scammer imitates and the only defence is that ours is boring, expected
 * and visibly theirs. A home without one gets its telephone number. And a
 * pre-need plan gets neither, because there is nothing to pay.
 */
function payingBlock(input: StatementInput): string {
  const { home, settings } = input;

  if (input.case.kind === "pre_need") {
    return `<section class="paying">
  <h2>This is a plan, not a bill</h2>
  <p>
    Nothing is owed and nothing is being collected. This sheet records what
    ${esc(home.name)} has been asked to arrange, at today's prices, so that
    whoever reads it next knows what was wanted.
  </p>
</section>`;
  }

  const url = settings?.paymentPageUrl?.trim();
  const instructions = settings?.paymentInstructions?.trim();

  const ways: string[] = [];

  if (url) {
    ways.push(
      `<p>Online, at ${esc(home.name)}'s own payment page:</p>` +
        `<p><a href="${esc(url)}">${esc(url)}</a></p>` +
        `<p class="destination">This link goes to ${esc(hostOf(url))}.</p>`,
    );
  }

  if (instructions) ways.push(`<div>${lines(instructions)}</div>`);

  if (ways.length === 0) {
    ways.push(
      home.phone
        ? `<p>Please telephone ${esc(home.name)} on ${esc(home.phone)} and they will tell you how they would like to be paid.</p>`
        : `<p>Please telephone ${esc(home.name)} and they will tell you how they would like to be paid.</p>`,
    );
  }

  return `<section class="paying">
  <h2>Paying ${esc(home.name)}</h2>
  ${ways.join("\n")}
</section>`;
}

/** The host, for showing a family where a link actually goes. */
export function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

export function renderStatement(input: StatementInput): string {
  const { home, selection } = input;
  const subject = decedentDisplayName(input.case);
  const total = selectionTotalCents(input.lines);

  const dated = formatDay(selection.confirmedAt ?? new Date());
  const pricedFrom = formatDay(selection.gplEffectiveOn);

  const body = [
    letterhead(home, input.logoDataUri),
    `<h1>Statement of Funeral Goods and Services Selected</h1>`,
    `<p class="subject"><strong>${esc(subject)}</strong></p>`,
    `<p class="effective">${esc(dated)}${
      pricedFrom ? ` · at the prices effective ${esc(pricedFrom)}` : ""
    }${selection.status === "draft" ? " · draft, not yet agreed" : ""}</p>`,
    input.lines.length === 0
      ? `<p class="empty">Nothing has been chosen yet.</p>`
      : `<section class="group"><table>
${input.lines.map(statementRow).join("\n")}
<tr class="total"><td>Total</td><td class="amount">${esc(formatPrice(total))}</td></tr>
</table></section>`,
    selection.notes ? `<div class="footnote">${lines(selection.notes)}</div>` : "",
    payingBlock(input),
  ].join("\n");

  return documentShell({
    title: `${subject} — Statement of Funeral Goods and Services Selected`,
    accent: accentOf(home),
    extraCss: STATEMENT_CSS,
    body,
  });
}
