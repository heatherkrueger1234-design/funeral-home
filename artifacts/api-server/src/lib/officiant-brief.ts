import {
  decedentDisplayName,
  type Case,
  type FamilyContact,
  type FuneralHome,
  type ServiceSelection,
} from "@workspace/db";
import type { MemoryJson } from "./memories";

/**
 * One sheet of paper for whoever is taking the service.
 *
 * The thing this replaces is a telephone call. A minister who never met the
 * person rings the funeral home the afternoon before and a director reads out
 * what they can remember of what the family said — which means the good
 * details, the ones that make a eulogy sound like it is about a particular
 * person, survive only as far as somebody's short-term memory of a phone
 * call. Half of them do not reach the pulpit at all.
 *
 * So: the facts the home already holds, the choices the family has already
 * made, and the stories the family has already written down, on one page, in
 * the order it will be needed.
 *
 * Rendered the same way the print templates are, and for the same reasons:
 * self-contained HTML with a `@page` rule, because every browser has a better
 * PDF writer behind Ctrl-P than a library bolted on here, because a director
 * can read it before committing, and because it can be sent as an email body
 * without becoming an attachment nobody opens on a phone.
 *
 * Two things it deliberately is not. It is not an order of service — the
 * congregation's document is a print template with a fixed layout, and this
 * is a working paper that can run to two pages without anybody minding. And
 * it carries only the memories the family marked for the minister: the rest
 * are theirs, written into a portal their funeral home gave them, and
 * handing those to a stranger because they happened to be in the same table
 * would be a betrayal of the reason they wrote them down at all.
 */

export type BriefInput = {
  case: Case;
  home: FuneralHome;
  contacts: FamilyContact[];
  selections: ServiceSelection[];
  memories: MemoryJson[];
  /** A line from the director, set above the sheet in an email. */
  note?: string | null;
};

/**
 * Everything interpolated below was typed by a person — a family's memory, a
 * home's name, the title of a hymn — so all of it goes through here.
 *
 * Both quote characters are escaped, not just the double. Nothing in this
 * template currently puts a value inside an attribute, which is exactly the
 * kind of fact that stops being true the first time somebody adds a `title`
 * to a list item. `lib/mailer` escapes the same six characters for the same
 * reason, and the two should not disagree about what safe means.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Preserve the paragraphs somebody typed. They are the only formatting here. */
function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const timeOnly = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});
const yearOnly = new Intl.DateTimeFormat("en-US", { year: "numeric" });

function fullDate(value: Date | null): string | null {
  return value ? longDate.format(value) : null;
}

/**
 * "1938 – 2026", which is how it is said aloud and how it is cut into stone.
 * Omitted entirely when neither date is known, rather than printed with a
 * gap for the minister to wonder about.
 */
function lifespan(row: Case): string | null {
  const born = row.dateOfBirth ? yearOnly.format(row.dateOfBirth) : null;
  const died = row.dateOfDeath ? yearOnly.format(row.dateOfDeath) : null;

  if (!born && !died) return null;
  return `${born ?? "—"} – ${died ?? "—"}`;
}

/** Whole years, the way an age is given in a eulogy. Null if either end is unknown. */
function ageAtDeath(row: Case): number | null {
  if (!row.dateOfBirth || !row.dateOfDeath) return null;

  const born = row.dateOfBirth;
  const died = row.dateOfDeath;
  let age = died.getFullYear() - born.getFullYear();

  const monthDiff = died.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && died.getDate() < born.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

const SELECTION_SECTIONS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "hymn", label: "Hymns" },
  { kind: "reading", label: "Readings" },
  { kind: "music", label: "Music" },
  { kind: "eulogist", label: "Speaking" },
  { kind: "pallbearer", label: "Pallbearers" },
  { kind: "other", label: "Also" },
];

function row(label: string, value: string | null): string {
  if (!value) return "";
  return `<div class="row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

export function renderOfficiantBrief(input: BriefInput): string {
  const { case: subject, home, contacts, selections, memories, note } = input;

  const name = decedentDisplayName(subject);
  const legalName = `${subject.decedentFirstName} ${subject.decedentLastName}`.trim();
  const preferred = subject.decedentPreferredName?.trim();
  const years = lifespan(subject);
  const age = ageAtDeath(subject);

  const serviceWhen = subject.serviceAt
    ? `${longDate.format(subject.serviceAt)}, ${timeOnly.format(subject.serviceAt)}`
    : null;

  const shared = memories.filter(
    (memory) => memory.kind === "memory" && memory.forOfficiant,
  );

  const selectionBlocks = SELECTION_SECTIONS.map((section) => {
    const rows = selections.filter((entry) => entry.kind === section.kind);
    if (rows.length === 0) return "";

    const items = rows
      .map((entry) => {
        const attribution = entry.attribution?.trim();
        const notes = entry.notes?.trim();
        return `<li><span class="thing">${esc(entry.value)}</span>${
          attribution ? `<span class="by"> — ${esc(attribution)}</span>` : ""
        }${notes ? `<span class="note"> (${esc(notes)})</span>` : ""}</li>`;
      })
      .join("");

    return `<div class="block"><h3>${esc(section.label)}</h3><ul>${items}</ul></div>`;
  }).join("");

  const familyRows = contacts
    .filter((contact) => contact.revokedAt === null)
    .map((contact) => {
      const parts = [contact.relationship?.trim(), contact.phone?.trim()].filter(
        Boolean,
      ) as string[];
      return `<li><span class="thing">${esc(contact.name)}</span>${
        parts.length ? `<span class="by"> — ${esc(parts.join(" · "))}</span>` : ""
      }${
        contact.role === "next_of_kin"
          ? '<span class="tag">next of kin</span>'
          : ""
      }</li>`;
    })
    .join("");

  /*
   * Ruled lines, because this sheet gets written on. A minister takes it into
   * a vestry twenty minutes before and adds the two things the family tells
   * them at the door, and a page with nowhere to do that gets those two
   * things written up the side of the hymn list.
   */
  const noteLines = Array.from({ length: 6 }, () => '<div class="rule"></div>').join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(name)} — for the service</title>
<style>
  /*
   * Letter, with a generous margin: this is read from a lectern or a lap,
   * not filed. Fonts are a stack rather than a web font because this is
   * emailed as often as it is printed, and a mail client that cannot reach
   * Google Fonts should still set it in something with serifs.
   */
  @page { size: letter; margin: 0.75in; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1b201d;
    background: #ffffff;
  }

  /* On screen the sheet sits on the page the way it will come out of the
     printer. In print the page box already does that, so the frame goes. */
  .sheet { max-width: 7in; margin: 0.5in auto; padding: 0 0.25in; }
  @media print { .sheet { margin: 0; padding: 0; max-width: none; } }

  h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; }

  .eyebrow {
    font-size: 8pt;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6a6f68;
    margin: 0 0 2pt;
  }

  header.top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1.5pt solid #1b201d;
    padding-bottom: 6pt;
    margin-bottom: 14pt;
  }
  header.top .home { font-family: Georgia, serif; font-size: 12pt; font-weight: 600; }
  header.top .what { font-size: 9pt; color: #6a6f68; }

  h1 { font-size: 22pt; line-height: 1.15; margin: 0; }
  .years { font-family: Georgia, serif; font-size: 12pt; color: #4a524c; margin: 2pt 0 0; }

  h2 {
    font-size: 10pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6a6f68;
    border-bottom: 0.5pt solid #d8cfc0;
    padding-bottom: 3pt;
    margin: 18pt 0 8pt;
  }

  h3 { font-size: 10.5pt; margin: 0 0 3pt; }

  dl { margin: 0; }
  .row { display: flex; gap: 10pt; padding: 2pt 0; }
  .row dt { width: 1.15in; flex: none; color: #6a6f68; font-size: 9.5pt; }
  .row dd { margin: 0; }

  ul { margin: 0; padding-left: 14pt; }
  li { margin: 0 0 2pt; }
  .thing { font-weight: 600; }
  .by, .note { color: #4a524c; font-weight: 400; }
  .tag {
    margin-left: 5pt;
    font-size: 7.5pt;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border: 0.5pt solid #d8cfc0;
    border-radius: 2pt;
    padding: 0.5pt 3pt;
    color: #6a6f68;
  }

  .columns { display: flex; gap: 22pt; }
  .columns > * { flex: 1; }
  .block { margin-bottom: 10pt; }

  /* A memory is the part that gets read aloud, so it is set to be read
     aloud: wider leading than the rest of the page and a rule down the
     side, the way a pull quote is set. */
  .memory {
    border-left: 2pt solid #d8cfc0;
    padding: 0 0 0 10pt;
    margin: 0 0 12pt;
  }
  .memory .prompt { font-size: 9pt; color: #6a6f68; font-style: italic; margin: 0 0 3pt; }
  .memory p { margin: 0 0 6pt; line-height: 1.6; }
  .memory .who { font-size: 9pt; color: #6a6f68; margin: 0; }

  .rule { border-bottom: 0.5pt solid #d8cfc0; height: 22pt; }

  .note-from {
    border: 0.5pt solid #d8cfc0;
    background: #fbf9f5;
    padding: 8pt 10pt;
    margin: 0 0 14pt;
    font-size: 10pt;
  }

  footer {
    margin-top: 20pt;
    padding-top: 6pt;
    border-top: 0.5pt solid #d8cfc0;
    font-size: 8.5pt;
    color: #6a6f68;
    display: flex;
    justify-content: space-between;
  }

  /* Never split a memory or a list across two sheets. */
  .memory, .block, section { break-inside: avoid; }
</style>
</head>
<body>
<div class="sheet">

  <header class="top">
    <span class="home">${esc(home.name)}</span>
    <span class="what">For the service</span>
  </header>

  ${note?.trim() ? `<div class="note-from">${paragraphs(note.trim())}</div>` : ""}

  <h1>${esc(name)}</h1>
  ${years ? `<p class="years">${esc(years)}</p>` : ""}

  <h2>The service</h2>
  <dl>
    ${row("When", serviceWhen)}
    ${row("Where", subject.serviceLocation)}
  </dl>

  <!--
    Never "her name" or "his name". There is no gender on a case and there is
    not going to be one, so any heading that assumes one is wrong for some
    proportion of the people this is printed for — and the one place it would
    be read is in a minister's hands, minutes before they stand up and speak
    about somebody.
  -->
  <h2>Name and dates</h2>
  <dl>
    ${row("Full name", legalName !== name ? legalName : null)}
    ${row("Known as", preferred && preferred !== subject.decedentFirstName ? preferred : null)}
    ${row("Age", age !== null ? `${age}` : null)}
    ${row("Born", fullDate(subject.dateOfBirth))}
    ${row("Died", fullDate(subject.dateOfDeath))}
  </dl>

  ${
    familyRows
      ? `<h2>The family</h2><ul>${familyRows}</ul>`
      : ""
  }

  ${selectionBlocks ? `<h2>Chosen for the service</h2>${selectionBlocks}` : ""}

  <h2>About them, in the family's words</h2>
  ${
    shared.length === 0
      ? `<p style="color:#6a6f68">The family has not marked anything to be read. Worth a telephone call before the service.</p>`
      : shared
          .map(
            (memory) => `
    <div class="memory">
      ${memory.prompt ? `<p class="prompt">${esc(memory.prompt)}</p>` : ""}
      ${paragraphs(memory.body)}
      ${memory.authorName ? `<p class="who">— ${esc(memory.authorName)}</p>` : ""}
    </div>`,
          )
          .join("")
  }

  <h2>Notes</h2>
  ${noteLines}

  <footer>
    <span>${esc(home.name)}${home.phone ? ` · ${esc(home.phone)}` : ""}</span>
    <span>Prepared ${esc(longDate.format(new Date()))}</span>
  </footer>

</div>
</body>
</html>`;
}

/**
 * The same sheet as plain text.
 *
 * Needed twice over. An email needs a text part or it looks like spam to
 * half the filters it passes through, and — the reason that matters here —
 * when SMTP is not configured the mailer logs the text body instead of
 * sending it, which is how a deployment without mail set up still lets
 * somebody get at the thing they asked for.
 */
export function renderOfficiantBriefText(input: BriefInput): string {
  const { case: subject, home, contacts, selections, memories, note } = input;

  const name = decedentDisplayName(subject);
  const years = lifespan(subject);
  const age = ageAtDeath(subject);
  const lines: string[] = [];

  const heading = (text: string) => {
    lines.push("", text.toUpperCase(), "-".repeat(text.length));
  };

  lines.push(`${home.name} — for the service`, "");
  if (note?.trim()) lines.push(note.trim(), "");

  lines.push(years ? `${name}   ${years}` : name);

  heading("The service");
  if (subject.serviceAt) {
    lines.push(
      `When:  ${longDate.format(subject.serviceAt)}, ${timeOnly.format(subject.serviceAt)}`,
    );
  }
  if (subject.serviceLocation) lines.push(`Where: ${subject.serviceLocation}`);

  heading("Name and dates");
  if (age !== null) lines.push(`Age:   ${age}`);
  if (subject.dateOfBirth) lines.push(`Born:  ${longDate.format(subject.dateOfBirth)}`);
  if (subject.dateOfDeath) lines.push(`Died:  ${longDate.format(subject.dateOfDeath)}`);

  const living = contacts.filter((contact) => contact.revokedAt === null);
  if (living.length > 0) {
    heading("The family");
    for (const contact of living) {
      const detail = [contact.relationship?.trim(), contact.phone?.trim()]
        .filter(Boolean)
        .join(" · ");
      lines.push(
        `- ${contact.name}${detail ? ` — ${detail}` : ""}${
          contact.role === "next_of_kin" ? "  [next of kin]" : ""
        }`,
      );
    }
  }

  const chosen = SELECTION_SECTIONS.filter((section) =>
    selections.some((entry) => entry.kind === section.kind),
  );
  if (chosen.length > 0) {
    heading("Chosen for the service");
    for (const section of chosen) {
      lines.push(`${section.label}:`);
      for (const entry of selections.filter((row) => row.kind === section.kind)) {
        const attribution = entry.attribution?.trim();
        const notes = entry.notes?.trim();
        lines.push(
          `  - ${entry.value}${attribution ? ` — ${attribution}` : ""}${
            notes ? ` (${notes})` : ""
          }`,
        );
      }
    }
  }

  heading("About them, in the family's words");
  const shared = memories.filter(
    (memory) => memory.kind === "memory" && memory.forOfficiant,
  );

  if (shared.length === 0) {
    lines.push(
      "The family has not marked anything to be read. Worth a telephone call",
      "before the service.",
    );
  } else {
    for (const memory of shared) {
      if (memory.prompt) lines.push(`(${memory.prompt})`);
      lines.push(memory.body.trim());
      if (memory.authorName) lines.push(`— ${memory.authorName}`);
      lines.push("");
    }
  }

  lines.push("", home.phone ? `${home.name} · ${home.phone}` : home.name);

  return lines.join("\n");
}
