/**
 * Reading a CSV a funeral home actually exported.
 *
 * Hand-written rather than a dependency, because the job is narrow and the
 * inputs are hostile in specific, known ways. What arrives is an export from
 * Passare, Osiris, FDMS or SRS, usually opened in Excel first and saved
 * again — which means:
 *
 *  - a UTF-8 BOM on the first header, so `"Last Name"` silently becomes
 *    `"\uFEFFLast Name"` and matches nothing;
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
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function parseCsv(text: string): ParsedCsv {
  const rows = parseRows(text);

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0]!.map((header) => header.replace(/^\uFEFF/, "").trim());

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
 * A date as an export wrote it: the calendar day, the time of day if there
 * was one, and nothing more.
 *
 * Not an instant, on purpose. These exports write a service as wall-clock
 * time at the home -- "9/18/2026 1:00 PM" -- and which clock that is only the
 * caller knows. This used to build a `Date` from the parts in the *server's*
 * zone, which is UTC, so every imported service landed six or seven hours
 * early for a home in Colorado: a one o'clock funeral printed on the cards as
 * seven in the morning, and one given only a date, as the evening before.
 */
export type WrittenDate = {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** The time of day, when one was written. */
  time: { hour: number; minute: number } | null;
  /**
   * The instant meant, when the export gave its own offset ("Z", "-06:00").
   * It then outranks the home's clock: somebody already said which it was.
   */
  instant: Date | null;
};

/*
 * What may follow the date: a time, perhaps with seconds or a.m./p.m., then
 * perhaps an offset or a zone's short name. Anchored at both ends, and that is
 * the point: an unanchored pattern read the "1:00" of "1:00 PM", ignored the
 * rest, and put a funeral at one in the morning.
 */
const AFTER_DATE =
  /^(?:(?:T|\s+)(\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:\.\d+)?)?\s*(?:([ap])\.?\s?m\.?)?)?\s*(z|[+-]\d{2}:?\d{2}|[a-z]{2,5})?$/i;

/**
 * Dates, as they actually appear in these exports.
 *
 * Returns null rather than guessing when the format is ambiguous and wrong,
 * and that includes a day that does not exist: February the 31st used to
 * become the 3rd of March. An unparseable service date leaves the case
 * undated, which a director will notice and fix; a date silently read as the
 * wrong month is a family told the wrong day.
 */
export function parseDate(raw: string): WrittenDate | null {
  const value = raw.trim();
  if (!value) return null;

  let year: number;
  let month: number;
  let day: number;
  let rest: string;

  // ISO first: unambiguous, and what a well-behaved export produces.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  // US ordering, which is what these systems emit. Read as month/day because
  // the exports come from US jurisdictions; a 13+ first component is treated
  // as day/month rather than rejected, since that can only be one thing.
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/.exec(value);

  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    rest = value.slice(iso[0].length);
  } else if (slash) {
    [month, day] = [Number(slash[1]), Number(slash[2])];
    if (month > 12 && day <= 12) [month, day] = [day, month];
    year = Number(slash[3]!.length === 2 ? `20${slash[3]}` : slash[3]);
    rest = value.slice(slash[0].length);
  } else {
    return null;
  }

  // A day that exists, checked by asking the calendar rather than by range.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  const after = AFTER_DATE.exec(rest);
  if (!after) return null;
  const [, rawHour, rawMinute, , meridiem, zone] = after;

  let time: WrittenDate["time"] = null;
  if (rawHour !== undefined) {
    let hour = Number(rawHour);
    const minute = Number(rawMinute ?? 0);
    // "1 PM" is a time; a bare "13" is not one anybody writes.
    if (rawMinute === undefined && !meridiem) return null;
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem.toLowerCase() === "p" ? 12 : 0);
    }
    if (hour > 23 || minute > 59) return null;
    time = { hour, minute };
  }

  /*
   * An explicit offset means the export named the instant, so it is kept as
   * one. A zone's short name ("MDT") is the home's own clock in every export
   * seen so far and is read as such -- except UTC and GMT, which say the
   * same thing as "Z".
   */
  let instant: Date | null = null;
  if (zone && time) {
    const offset = /^[+-]/.test(zone)
      ? zone
      : /^(z|utc|gmt)$/i.test(zone)
        ? "+00:00"
        : null;
    if (offset) {
      const sign = offset[0] === "-" ? -1 : 1;
      const digits = offset.slice(1).replace(":", "");
      const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
      instant = new Date(
        Date.UTC(year, month - 1, day, time.hour, time.minute) - sign * minutes * 60_000,
      );
    }
  }

  return { year, month, day, time, instant };
}

/**
 * One CSV cell. Quoted when it must be, and a leading = + - @ (or tab/CR)
 * is prefixed with an apostrophe so a spreadsheet opens it as text rather
 * than running it as a formula.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole CSV: CRLF line ends and a BOM, which is what Excel expects. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
