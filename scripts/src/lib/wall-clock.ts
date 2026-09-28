/**
 * A moment at a given wall-clock time in a given timezone.
 *
 * The showcase seed used to add hours to "now", so a demo run at 3pm put the
 * funeral at 10pm and the director's replies at 2am. This anchors every seeded
 * moment to a real time of day where the home is, whatever the host clock says.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minutes the zone is ahead of UTC at that instant (Denver in July: -360). */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * `hour:minute` local time in `timeZone`, on the calendar day `offsetDays`
 * from `now` (as that zone sees it).
 */
export function wallClock(
  now: Date,
  offsetDays: number,
  hour: number,
  minute = 0,
  timeZone = "America/Denver",
): Date {
  const day = new Date(now.getTime() + offsetDays * DAY_MS);
  const [year, month, date] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(day)
    .split("-")
    .map(Number);

  const guess = Date.UTC(year!, month! - 1, date!, hour, minute);
  // Twice, so a guess on the far side of a daylight-saving change settles.
  let result = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  result = guess - zoneOffsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}

/** The hour of the day at `at`, in `timeZone`. */
export function localHour(at: Date, timeZone = "America/Denver"): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(at),
  );
}
