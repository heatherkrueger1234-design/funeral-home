import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    return format(parseISO(dateString), "MMMM do, yyyy");
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    return format(parseISO(dateString), "MMMM do, yyyy 'at' h:mm a");
  } catch {
    return dateString;
  }
}

/**
 * A moment at the funeral home, on the funeral home's clock.
 *
 * Every time in this portal is somewhere the family has to *be* — the
 * service, the day the clothing is needed by — and those happen in the
 * home's town, not wherever the phone reading this happens to be. Formatting
 * in the browser's own zone told a daughter arranging her mother's funeral
 * from two states away that an 11 o'clock service was at 1, which is the one
 * mistake ServiceTime exists to prevent ("a family arriving at the wrong
 * hour").
 *
 * When the reader's zone differs from the home's, the zone is named, so the
 * sentence is still true for them; when it is the same, it is left off
 * rather than cluttering every date on the page with "MDT".
 */
export function formatAtHome(
  value: string | Date | null | undefined,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const zone = validZone(timeZone);
  const showZone =
    zone !== undefined &&
    "hour" in options &&
    zone !== Intl.DateTimeFormat().resolvedOptions().timeZone;

  return date.toLocaleString(undefined, {
    ...options,
    ...(zone ? { timeZone: zone } : {}),
    ...(showZone ? { timeZoneName: "short" } : {}),
  });
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
