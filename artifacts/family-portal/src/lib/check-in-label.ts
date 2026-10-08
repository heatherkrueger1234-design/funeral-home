/**
 * What each aftercare note is called on the family's list of dates.
 *
 * The same wording as the director sees in Settings (the API's labels), so
 * a family who asks "what is the one in September?" and a director looking
 * at the same screen are talking about the same note.
 */

/** The harder days a home may offer on top of the four check-ins. */
export const TOUCHPOINT_LABELS: Record<string, string> = {
  birthday: "Their birthday",
  holidays: "Before the first holidays",
  death_anniversary: "A year since they died",
};

const CHECK_INS: Record<number, string> = {
  30: "A month on",
  60: "Two months on",
  90: "Three months on",
  365: "A year after the service",
};

const COUNT = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/**
 * A check-in on a day the standard schedule does not name, written as a
 * sentence rather than "Day 180", which reads like a chart at the end of a
 * bed. Whole months when the offset divides neatly, otherwise days.
 */
function afterTheService(dayOffset: number): string {
  const months = dayOffset / 30;
  if (dayOffset > 0 && Number.isInteger(months) && months < COUNT.length) {
    const count = COUNT[months]!;
    return `${count[0]!.toUpperCase()}${count.slice(1)} month${months === 1 ? "" : "s"} after the service`;
  }
  return `${dayOffset} day${dayOffset === 1 ? "" : "s"} after the service`;
}

export function checkInLabel(delivery: { kind: string; dayOffset: number }): string {
  return (
    TOUCHPOINT_LABELS[delivery.kind] ??
    CHECK_INS[delivery.dayOffset] ??
    afterTheService(delivery.dayOffset)
  );
}
