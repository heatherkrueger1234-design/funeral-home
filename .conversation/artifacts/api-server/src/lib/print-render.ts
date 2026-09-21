import { findTemplate, type PrintTemplate } from "./print-templates";
import { decedentDisplayName, type Case, type FuneralHome } from "@workspace/db";

/**
 * Turning a print item into something a printer can actually use.
 *
 * HTML with physical units and a `@page` rule, rather than a PDF built in
 * this process. Three reasons:
 *
 *  1. Every browser already has a competent PDF writer behind Ctrl-P, and it
 *     handles fonts, colour profiles and the print dialogue better than a
 *     library bolted on here would.
 *  2. A director can look at it before committing, which is the step that
 *     catches a misspelled name.
 *  3. It can be emailed to the print shop as-is.
 *
 * Everything is in inches because that is what the trade uses and what the
 * card stock is cut to. Bleed is included on anything with a photograph that
 * runs to the edge — without it, a guillotine a millimetre out leaves a white
 * hairline down the side of somebody's mother.
 */

/** Standard trade bleed. */
const BLEED = 0.125;

export type RenderInput = {
  template: PrintTemplate;
  case: Case;
  home: FuneralHome;
  values: Record<string, string>;
  /** Resolved server-side so the HTML is self-contained. */
  photoDataUri: string | null;
  logoDataUri: string | null;
};

/** Escape for HTML. Everything here is typed by a person. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preserve the line breaks a director typed, which are the layout. */
function lines(value: string): string {
  return esc(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => (line === "" ? "<br>" : `<div>${line}</div>`))
    .join("\n");
}

function formatDates(row: Case): string {
  const year = (value: Date | null) =>
    value ? String(value.getFullYear()) : "";

  const born = year(row.dateOfBirth);
  const died = year(row.dateOfDeath);

  if (born && died) return `${born} — ${died}`;
  if (died) return died;
  return "";
}

function formatServiceLine(row: Case): string {
  if (!row.serviceAt) return row.serviceLocation ?? "";

  const when = row.serviceAt.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return row.serviceLocation ? `${when}\n${row.serviceLocation}` : when;
}

/** Fill a slot: what was typed, else what the case already knows. */
export function resolveSlots(input: {
  template: PrintTemplate;
  case: Case;
  values: Record<string, string>;
}): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const slot of input.template.slots) {
    const typed = input.values[slot.key];

    if (typed !== undefined && typed !== "") {
      resolved[slot.key] = typed;
      continue;
    }

    switch (slot.from) {
      case "decedentName":
        resolved[slot.key] = decedentDisplayName(input.case);
        break;
      case "dates":
        resolved[slot.key] = formatDates(input.case);
        break;
      case "serviceLine":
        resolved[slot.key] = formatServiceLine(input.case);
        break;
      default:
        resolved[slot.key] = "";
    }
  }

  return resolved;
}

function panel(contents: string, options: { className?: string } = {}): string {
  return `<section class="panel ${options.className ?? ""}">${contents}</section>`;
}

function photoBlock(dataUri: string | null, alt: string): string {
  if (!dataUri) {
    // An empty frame rather than a collapsed layout, so a director sees
    // immediately that no photograph has been chosen.
    return `<div class="photo photo--empty" role="img" aria-label="No photograph chosen"></div>`;
  }
  return `<div class="photo"><img src="${dataUri}" alt="${esc(alt)}"></div>`;
}

/**
 * The layouts.
 *
 * Written out per template rather than generated from the slot list, because
 * a prayer card and an order of service are genuinely different objects and
 * a generic renderer would produce something that is technically all of them
 * and properly none of them.
 */
function body(input: RenderInput, slots: Record<string, string>): string {
  const name = esc(slots["name"] ?? "");
  const dates = esc(slots["dates"] ?? "");
  const photo = photoBlock(input.photoDataUri, slots["name"] ?? "");

  const homeMark = input.logoDataUri
    ? `<img class="mark" src="${input.logoDataUri}" alt="">`
    : `<div class="mark mark--text">${esc(input.home.name)}</div>`;

  switch (input.template.key) {
    case "prayer-card":
      return [
        panel(
          `${photo}<h1>${name}</h1><p class="dates">${dates}</p>`,
          { className: "panel--front" },
        ),
        panel(
          `<div class="verse">${lines(slots["verse"] ?? "")}</div>` +
            `<div class="footer">${esc(slots["closing"] ?? "")}${homeMark}</div>`,
          { className: "panel--back" },
        ),
      ].join("");

    case "bookmark":
      return panel(
        `${photo}<h1>${name}</h1><p class="dates">${dates}</p>` +
          `<div class="verse">${lines(slots["verse"] ?? "")}</div>${homeMark}`,
        { className: "panel--tall" },
      );

    case "program-folded":
      // Printed as four pages in reading order; the print dialogue's
      // duplex/booklet setting imposes them. Deliberately not imposed here:
      // every shop's equipment disagrees about that, and getting it wrong
      // wastes two hundred sheets.
      return [
        panel(
          `${photo}<h1>${name}</h1><p class="dates">${dates}</p>` +
            `<p class="service">${lines(slots["serviceLine"] ?? "")}</p>`,
          { className: "panel--front" },
        ),
        panel(
          `<h2>Order of Service</h2><div class="order">${lines(slots["order"] ?? "")}</div>`,
        ),
        panel(
          `${slots["bearers"] ? `<h2>Pallbearers</h2><div class="bearers">${lines(slots["bearers"])}</div>` : ""}` +
            `${slots["thanks"] ? `<div class="thanks">${lines(slots["thanks"])}</div>` : ""}`,
        ),
        panel(
          `${slots["reception"] ? `<p class="reception">${lines(slots["reception"])}</p>` : ""}${homeMark}`,
          { className: "panel--back" },
        ),
      ].join("");

    case "program-single":
      return panel(
        `${photo}<h1>${name}</h1><p class="dates">${dates}</p>` +
          `<p class="service">${lines(slots["serviceLine"] ?? "")}</p>` +
          `<h2>Order of Service</h2><div class="order">${lines(slots["order"] ?? "")}</div>` +
          homeMark,
      );

    case "register-page":
      return panel(
        `${photo}<h1>${name}</h1><p class="dates">${dates}</p>` +
          `<p class="service">${lines(slots["serviceLine"] ?? "")}</p>` +
          `<p class="prompt">In loving memory</p>${homeMark}`,
        { className: "panel--page" },
      );

    case "thank-you":
      return [
        panel(`${photo}<h1>${name}</h1>`, { className: "panel--front" }),
        panel(
          `<div class="message">${lines(slots["message"] ?? "")}</div>` +
            `<div class="signature-space"></div>${homeMark}`,
          { className: "panel--back" },
        ),
      ].join("");

    default:
      return panel(`<h1>${name}</h1><p class="dates">${dates}</p>`);
  }
}

export function renderPrintItem(input: RenderInput): string {
  const { template } = input;
  const slots = resolveSlots(input);

  const sheetWidth = template.width + BLEED * 2;
  const sheetHeight = template.height + BLEED * 2;

  const accent = /^#[0-9a-fA-F]{6}$/.test(input.home.accentColor)
    ? input.home.accentColor
    : "#1f4e46";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(slots["name"] ?? "Print")} — ${esc(template.name)}</title>
<style>
  /*
   * Physical units throughout. The @page size matches one panel plus bleed,
   * so "print to PDF" produces a file the shop can impose without rescaling
   * — the single most common way a card comes back the wrong size.
   */
  @page { size: ${sheetWidth}in ${sheetHeight}in; margin: 0; }

  :root { --accent: ${accent}; --bleed: ${BLEED}in; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    color: #1a1a1a;
    background: #f4f2ef;
  }

  .panel {
    width: ${sheetWidth}in;
    height: ${sheetHeight}in;
    padding: calc(var(--bleed) + 0.22in);
    background: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    overflow: hidden;
    /* Visible only on screen; break-inside keeps a panel off two pages. */
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 auto 0.25in;
    box-shadow: 0 1px 6px rgba(0,0,0,.14);
    position: relative;
  }

  .panel + .panel { page-break-before: always; }

  h1 {
    font-size: 15pt;
    line-height: 1.15;
    margin: .10in 0 .03in;
    font-weight: 600;
  }

  h2 {
    font-size: 10pt;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 .08in;
  }

  .dates { font-size: 10pt; color: #555; margin: 0 0 .08in; }
  .service, .reception { font-size: 9pt; line-height: 1.45; margin: .05in 0; }

  .photo {
    width: 100%;
    flex: 0 0 auto;
    aspect-ratio: 4 / 5;
    max-height: 55%;
    overflow: hidden;
    border-radius: 2pt;
  }
  .photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .photo--empty {
    border: 1px dashed #c9c2b8;
    background: repeating-linear-gradient(45deg,#faf8f5,#faf8f5 6px,#f2eee8 6px,#f2eee8 12px);
  }

  .verse, .order, .bearers, .thanks, .message {
    font-size: 9pt;
    line-height: 1.5;
    margin-top: .08in;
  }
  .order { text-align: center; }
  .order div { margin: .02in 0; }

  .prompt {
    font-size: 12pt;
    font-style: italic;
    color: var(--accent);
    margin-top: .2in;
  }

  /* Left deliberately empty: thank-you cards get signed by hand. */
  .signature-space { flex: 1 1 auto; min-height: .7in; }

  .footer {
    margin-top: auto;
    font-size: 8pt;
    color: #666;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .05in;
  }

  .mark { margin-top: auto; padding-top: .08in; max-width: 1.3in; opacity: .85; }
  .mark--text { font-size: 7.5pt; letter-spacing: .04em; color: #6b6b6b; }

  .panel--tall .verse { font-size: 8pt; }
  .panel--page h1 { font-size: 26pt; }
  .panel--page .photo { max-height: 45%; aspect-ratio: 1 / 1; width: 3.2in; }

  @media print {
    body { background: #fff; }
    .panel { margin: 0; box-shadow: none; }
    /* Backgrounds and the accent colour must survive the print dialogue. */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${body(input, slots)}
</body>
</html>`;
}
