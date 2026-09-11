/**
 * Reading a CSV a funeral home actually exported.
 *
 * Hand-written rather than a dependency, because the job is narrow and the
 * inputs are hostile in specific, known ways. What arrives is an export from
 * Passare, Osiris, FDMS or SRS, usually opened in Excel first and saved
 * again — which means:
 *
 *  - a UTF-8 BOM on the first header, so `"Last Name"` silently becomes
 *    `"﻿Last Name"` and matches nothing;
 *  - CRLF line endings;
 *  - quoted fields containing commas and newlines (an address, a note);
 *  - doubled quotes inside quoted fields;
 *  - a trailing blank line, and often several.
 *
 * A regex split on commas handles none of that. This is a proper character
 * scanner, which is about sixty lines and does.
 */

export type CsvRow = Record<string, string>;

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
};

/** Split CSV text into fields, respecting quotes. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // The BOM is invisible in every editor and breaks every header match.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    pushField();
    // Excel leaves trailing blank lines; a row of one empty field is one.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }

    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (char === "\r") {
      // CRLF, or a bare CR from a very old export.
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }

    if (char === "\n") {
      pushRow();
      i += 1;
      continue;
    }

    field += char;
    i += 1;
  }

  // Whatever is left when the text runs out is the last row.
  if (field !== "" || row.length > 0) pushRow();

  return rows;
}

/** Normalise a header so "Last Name", "last_name" and "LASTNAME" all match. */
export function normaliseHeader(header: string): string {
  return header
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function parseCsv(text: string): ParsedCsv {
  const rows = parseRows(text);

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0]!.map((header) => header.replace(/^﻿/, "").trim());

  const parsed = rows.slice(1).map((cells) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[normaliseHeader(header)] = (cells[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows: parsed };
}

/**
 * What each of our fields might be called in somebody else's export.
 *
 * Deliberately generous. A director should be able to drop in whatever their
 * system produced and have it mostly work, rather than rename eleven columns
 * first — the entire point of this feature is to remove typing, and a strict
 * importer just moves the typing into a spreadsheet.
 */
export const COLUMN_ALIASES: Record<string, readonly string[]> = {
  decedentFirstName: [
    "firstname", "first", "givenname", "decedentfirstname", "deceasedfirstname", "fname",
  ],
  decedentLastName: [
    "lastname", "last", "surname", "familyname", "decedentlastname", "deceasedlastname", "lname",
  ],
  decedentPreferredName: ["preferredname", "nickname", "knownas", "goesby"],
  dateOfBirth: ["dateofbirth", "dob", "birthdate", "born"],
  dateOfDeath: ["dateofdeath", "dod", "deathdate", "died", "dateofpassing"],
  serviceAt: ["servicedate", "servicedatetime", "serviceat", "funeraldate", "servicetime"],
  serviceLocation: ["servicelocation", "serviceplace", "venue", "chapel", "location"],
  postalCode: ["zip", "zipcode", "postalcode", "postcode"],
  contactName: [
    "nextofkin", "informant", "informantname", "contactname", "familycontact", "nokname",
  ],
  contactRelationship: ["relationship", "informantrelationship", "relation", "nokrelationship"],
  contactPhone: ["phone", "contactphone", "mobile", "cell", "informantphone", "nokphone"],
  contactEmail: ["email", "contactemail", "informantemail", "nokemail"],
};

/** Guess which incoming column feeds which of our fields. */
export function guessMapping(headers: string[]): Record<string, string | null> {
  const normalised = headers.map(normaliseHeader);
  const mapping: Record<string, string | null> = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalised.findIndex((header) =>
      aliases.includes(header),
    );
    mapping[field] = index === -1 ? null : headers[index]!;
  }

  return mapping;
}

/**
 * Dates, as they actually appear in these exports.
 *
 * Returns null rather than guessing when the format is ambiguous and wrong.
 * An unparseable service date leaves the case undated, which a director will
 * notice and fix; a date silently read as the wrong month is a family told
 * the wrong day.
 */
export function parseDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  // ISO first: unambiguous, and what a well-behaved export produces.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (iso) {
    const [, y, m, d, hh, mm] = iso;
    const date = new Date(
      Number(y), Number(m) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // US ordering, which is what these systems emit. Read as month/day because
  // the exports come from US jurisdictions; a 13+ first component is treated
  // as day/month rather than rejected, since that can only be one thing.
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[T ](\d{1,2}):(\d{2}))?/.exec(value);
  if (slash) {
    const [, a, b, rawYear, hh, mm] = slash;
    let month = Number(a);
    let day = Number(b);

    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
    }
    if (month > 12 || day > 31) return null;

    const year = Number(rawYear.length === 2 ? `20${rawYear}` : rawYear);
    const date = new Date(year, month - 1, day, Number(hh ?? 0), Number(mm ?? 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}
