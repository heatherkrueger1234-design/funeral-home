import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/*
 * ---------------------------------------------------------- the home's clock
 *
 * Every time in this console is a time at the funeral home: a service the
 * family has to arrive for, a step that goes past due, a message somebody
 * sent. They happen in the home's town. Formatting them in the browser's own
 * zone told a director at a conference two zones away -- or an arranger at
 * the sister location across a zone line -- that an eleven o'clock service
 * was at one, and a time typed into a picker on that laptop was stored two
 * hours out.
 *
 * So everything here is read and written on the home's clock
 * (`funeral_homes.timezone`, carried in the session). When the reader's zone
 * differs, a time says which zone it is in, so the sentence stays true for
 * them; when it is the same, the zone is left off rather than cluttering
 * every row with "MDT". The family portal has the same helper for the same
 * reason (`family-portal/src/lib/utils.ts`).
 */

/** A bare calendar date, such as a date of birth, with no time or zone. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The browser's own zone. */
export function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A moment at the funeral home, on the funeral home's clock.
 *
 * A bare date ("1942-03-04") is not a moment and is never moved into any
 * zone: it is formatted as the calendar day it names, so a date of birth
 * cannot slip to the day before for a reader west of Greenwich.
 */
export function formatAtHome(
  value: string | Date | null | undefined,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";

  if (typeof value === "string" && DATE_ONLY.test(value)) {
    return formatCalendarDate(value, options);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const zone = validZone(timeZone);
  const showZone =
    zone !== undefined && "hour" in options && zone !== browserZone();

  return date.toLocaleString(undefined, {
    ...options,
    ...(zone ? { timeZone: zone } : {}),
    ...(showZone ? { timeZoneName: "short" } : {}),
  });
}

/**
 * A calendar date, as the day it names.
 *
 * For a bare `YYYY-MM-DD`, and for the facts this API stores as midnight UTC
 * on the day (a date of death typed into a date picker): both are read in
 * UTC, which is the one zone where that midnight is the right day. Any time
 * fields in `options` are dropped, because there is no time to show.
 */
export function formatCalendarDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";
  const date =
    value instanceof Date
      ? value
      : new Date(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "";

  const {
    hour: _hour,
    minute: _minute,
    second: _second,
    timeZoneName: _zoneName,
    ...dateOnly
  } = options;
  return date.toLocaleDateString(undefined, { ...dateOnly, timeZone: "UTC" });
}

/**
 * Which calendar day an instant falls on at the home, as a whole number of
 * days since 1970. For "today", "tomorrow" and "3 days ago": a service at
 * eleven tonight in Denver is today in Denver, whatever day it already is
 * in London.
 */
export function homeDayNumber(
  value: string | Date,
  timeZone: string | null | undefined,
): number {
  const { year, month, day } = wallClock(
    value instanceof Date ? value : new Date(value),
    validZone(timeZone) ?? browserZone(),
  );
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * For a `datetime-local` input: the instant as wall time at the home, to the
 * minute, with no zone -- which is what the input shows and edits.
 */
export function toHomeInput(
  value: string | Date | null | undefined,
  timeZone: string | null | undefined,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const t = wallClock(date, validZone(timeZone) ?? browserZone());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}`;
}

/**
 * The other direction: what a director typed into a `datetime-local` input,
 * read as wall time at the home, as an ISO instant. `new Date(input)` would
 * read it in the browser's zone, which is the bug this file exists to stop.
 *
 * Across a daylight-saving change the offset is looked up at the instant it
 * lands on, not at the guess, so eleven o'clock on the first Sunday of
 * November is eleven o'clock.
 */
export function fromHomeInput(
  input: string,
  timeZone: string | null | undefined,
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(input);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as number[];
  const zone = validZone(timeZone) ?? browserZone();

  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let instant = wall - offsetAt(wall, zone);
  instant = wall - offsetAt(instant, zone);

  return new Date(instant).toISOString();
}

/** The zone's short name right now ("MDT"), or the zone id if it has none. */
export function zoneLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((entry) => entry.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * The line under a time picker when the laptop is not in the home's zone:
 * the picker takes the home's wall time, and a director who has flown to a
 * conference should be told so rather than find out from a family.
 */
export function zoneHint(timeZone: string | null | undefined): string | null {
  const zone = validZone(timeZone);
  if (!zone || zone === browserZone()) return null;
  return `Times here are the home's (${zoneLabel(zone)}), not this computer's.`;
}

/** Today's date at the home, for a `date` input's value or floor. */
export function homeToday(timeZone: string | null | undefined): string {
  return toHomeInput(new Date(), timeZone).slice(0, 10);
}

/** How far the zone's wall clock is ahead of UTC at an instant, in ms. */
function offsetAt(instant: number, zone: string): number {
  const t = wallClock(new Date(instant), zone);
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute);
  return asUtc - Math.floor(instant / 60_000) * 60_000;
}

function wallClock(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines still say "24" for midnight under h23.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** A stored zone the browser cannot use is ignored rather than thrown. */
function validZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}
