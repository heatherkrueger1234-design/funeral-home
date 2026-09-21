import type { FuneralHome } from "@workspace/db";

/**
 * Whether a moment falls inside a home's office hours.
 *
 * This gates nothing. A message written at 2am is delivered at 2am — see the
 * comment on `case_messages`. All this decides is whether the portal tells
 * the family, before they hit send, that their question will be read from
 * eight in the morning, and offers the 24-hour line if it truly cannot wait.
 *
 * That distinction is the whole feature. Holding a bereaved family's message
 * back would be a lie about how fast it was seen, and would eventually cost
 * somebody something that mattered. Saying plainly when it will be read
 * protects the director's evening without deceiving anyone.
 */

/**
 * Minutes since midnight in a named timezone.
 *
 * `Intl.DateTimeFormat` rather than date arithmetic because the correct
 * answer depends on the home's local wall clock, including the two days a
 * year when a timezone offset changes. An hour's error on those days would
 * put the "we are open" banner up an hour early, which is exactly the sort
 * of small wrongness that makes a director stop trusting the tool.
 */
export function minutesInZone(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  // `hour12: false` renders midnight as "24" in some ICU versions.
  return (hour % 24) * 60 + minute;
}

/**
 * Homes that keep evening hours have a closing time before their opening
 * time — "open 17:00, closed 02:00" wraps past midnight. Handling the wrap
 * here rather than forbidding it keeps the settings honest for the homes
 * that actually work that way.
 */
export function isWithinOfficeHours(
  home: Pick<
    FuneralHome,
    "officeOpensMinute" | "officeClosesMinute" | "timezone"
  >,
  at: Date = new Date(),
): boolean {
  const now = minutesInZone(at, home.timezone);
  const { officeOpensMinute: opens, officeClosesMinute: closes } = home;

  // A home that never closes.
  if (opens === closes) return true;

  return opens < closes
    ? now >= opens && now < closes
    : now >= opens || now < closes;
}

/** "8:00 AM", for the sentence the family is shown. */
export function formatMinute(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
