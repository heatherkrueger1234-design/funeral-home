/**
 * What is coming.
 *
 * Birthdays and angel dates do not stop arriving, and they rarely arrive as a
 * surprise to the body — people describe dreading a date for weeks without
 * consciously knowing why. Naming it a little ahead is the single most useful
 * thing this app can do unprompted, so this is computed on every visit rather
 * than waiting to be asked for.
 *
 * Three things this deliberately does:
 *
 * 1. Different dates get different notice. A dentist appointment wants three
 *    days; the anniversary of a child's death wants three weeks, because the
 *    dread starts long before the date and the whole point is to name it
 *    before it lands.
 * 2. Mother's Day, Father's Day and the big holidays are computed rather than
 *    typed in. They are among the hardest days in the year for a bereaved
 *    parent, and asking someone to enter Christmas by hand is asking them to
 *    sit down and think about Christmas.
 * 3. Nothing is ever phrased as a countdown or a celebration. "In 3 weeks" is
 *    a warning; "Only 3 days to go!" would be obscene.
 */

/** The placeholder the API creates a profile with. Kept in one place so
 * the first-run check and the server cannot drift apart. */
export const DEFAULT_CHILD_NAME = "Your Child";

export type UpcomingKind =
  | "birthday"
  | "angelversary"
  | "milestone"
  | "holiday";

export type Upcoming = {
  key: string;
  kind: UpcomingKind;
  title: string;
  detail?: string;
  date: Date;
  /** 0 is today, 1 is tomorrow. */
  daysAway: number;
  /**
   * Whether this is one of the heavy ones. Used to give it more notice and a
   * gentler frame, not to make it louder.
   */
  heavy: boolean;
};

/** How far ahead to look at all. */
const HORIZON_DAYS = 45;

/**
 * Default notice per kind, in days, when a milestone does not set its own.
 * The heavy dates get weeks; an ordinary dated event gets a fortnight.
 */
const DEFAULT_NOTICE: Record<UpcomingKind, number> = {
  birthday: 30,
  angelversary: 30,
  holiday: 21,
  milestone: 14,
};

const WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five",
  "Six", "Seven", "Eight", "Nine", "Ten",
];

const spell = (n: number) => WORDS[n] ?? String(n);

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Parses a `YYYY-MM-DD` string into a *local* date.
 *
 * `new Date("2002-04-01")` is parsed as UTC midnight, which renders as the
 * previous day for anyone west of Greenwich. Getting someone's child's
 * birthday off by one day is not an acceptable rounding error.
 */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;

  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));

  return Number.isNaN(date.getTime()) ? null : date;
}

const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 86_400_000);

/** The next time this month-and-day comes around, today included. */
function nextAnniversary(original: Date, today: Date): Date {
  const thisYear = new Date(
    today.getFullYear(),
    original.getMonth(),
    original.getDate(),
  );

  return thisYear >= today
    ? thisYear
    : new Date(today.getFullYear() + 1, original.getMonth(), original.getDate());
}

/** The nth given weekday of a month, e.g. the 2nd Sunday in May. */
function nthWeekdayOf(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

/** The last given weekday of a month, e.g. the last Monday in May. */
function lastWeekdayOf(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

type HolidaySpec = {
  key: string;
  title: string;
  detail: string;
  /** Given a year, where does it fall. */
  on: (year: number) => Date;
};

/**
 * The days that are hardest, rather than the days that are official.
 *
 * Mother's Day and Father's Day are here because they are frequently named as
 * the worst day of the year by bereaved parents, and because nobody thinks to
 * warn them. US dates: this is the audience the rest of the guides are written
 * for, and a wrong date would be worse than none.
 */
const HOLIDAYS: HolidaySpec[] = [
  {
    key: "mothers-day",
    title: "Mother's Day",
    detail: "It is allowed to be an ordinary Sunday. You can leave the phone off.",
    on: (year) => nthWeekdayOf(year, 4, 0, 2), // 2nd Sunday in May
  },
  {
    key: "fathers-day",
    title: "Father's Day",
    detail: "It is allowed to be an ordinary Sunday. You can leave the phone off.",
    on: (year) => nthWeekdayOf(year, 5, 0, 3), // 3rd Sunday in June
  },
  {
    key: "thanksgiving",
    title: "Thanksgiving",
    detail: "The table is a decision. Either answer is right.",
    on: (year) => nthWeekdayOf(year, 10, 4, 4), // 4th Thursday in November
  },
  {
    key: "christmas",
    title: "Christmas",
    detail: "You are allowed to not do it this year.",
    on: (year) => new Date(year, 11, 25),
  },
  {
    key: "new-year",
    title: "New Year's Eve",
    detail: "The turn into a year they were never alive in catches people out.",
    on: (year) => new Date(year, 11, 31),
  },
];

/** The next occurrence of a holiday, this year or next. */
function nextHoliday(spec: HolidaySpec, today: Date): Date {
  const thisYear = spec.on(today.getFullYear());
  return thisYear >= today ? thisYear : spec.on(today.getFullYear() + 1);
}

export function describeDaysAway(daysAway: number): string {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  if (daysAway < 7) return `In ${daysAway} days`;
  if (daysAway < 14) return "Next week";
  return `In ${Math.round(daysAway / 7)} weeks`;
}

export type MilestoneSource = {
  id: number;
  title: string;
  milestoneDate: string;
  type?: string | null;
  description?: string | null;
  recurring?: boolean;
  noticeDays?: number | null;
};

type Sources = {
  childName?: string | null;
  childBirthDate?: string | null;
  childPassingDate?: string | null;
  milestones?: MilestoneSource[];
  /**
   * Whether to include the computed holidays. On by default; off is for
   * someone who does not want Christmas mentioned to them in November.
   */
  includeHolidays?: boolean;
};

/** Milestone types that deserve the longer, gentler notice. */
const HEAVY_TYPES = new Set(["birthday", "deathday", "anniversary", "graduation"]);

export function computeUpcoming(sources: Sources): Upcoming[] {
  const today = startOfToday();
  const name = sources.childName?.trim() || "Their";
  const possessive = name.endsWith("s") ? `${name}'` : `${name}'s`;
  const found: Upcoming[] = [];

  const birth = parseLocalDate(sources.childBirthDate);
  if (birth) {
    const date = nextAnniversary(birth, today);
    const turning = date.getFullYear() - birth.getFullYear();

    found.push({
      key: "birthday",
      kind: "birthday",
      title: `${possessive} birthday`,
      detail: turning > 0 ? `${name} would have been ${turning}.` : undefined,
      date,
      daysAway: daysBetween(today, date),
      heavy: true,
    });
  }

  const passing = parseLocalDate(sources.childPassingDate);
  if (passing) {
    const date = nextAnniversary(passing, today);
    const years = date.getFullYear() - passing.getFullYear();

    found.push({
      key: "angelversary",
      kind: "angelversary",
      title: years === 1 ? "One year" : `${spell(years)} years`,
      detail:
        years > 0
          ? `Since the day you lost ${name === "Their" ? "them" : name}.`
          : undefined,
      date,
      daysAway: daysBetween(today, date),
      heavy: true,
    });
  }

  for (const milestone of sources.milestones ?? []) {
    const original = parseLocalDate(milestone.milestoneDate);
    if (!original) continue;

    // A recurring date rolls forward to its next occurrence. A one-off — "he
    // would have graduated in 2027" — simply stops once it has passed.
    const date = milestone.recurring
      ? nextAnniversary(original, today)
      : original;

    const daysAway = daysBetween(today, date);
    if (daysAway < 0) continue;

    const heavy = HEAVY_TYPES.has(milestone.type ?? "");

    found.push({
      key: `milestone-${milestone.id}`,
      kind: "milestone",
      title: milestone.title,
      detail: milestone.description ?? undefined,
      date,
      daysAway,
      heavy,
    });
  }

  if (sources.includeHolidays !== false) {
    for (const spec of HOLIDAYS) {
      const date = nextHoliday(spec, today);
      found.push({
        key: spec.key,
        kind: "holiday",
        title: spec.title,
        detail: spec.detail,
        date,
        daysAway: daysBetween(today, date),
        heavy: true,
      });
    }
  }

  return found
    .filter((item) => {
      if (item.daysAway < 0 || item.daysAway > HORIZON_DAYS) return false;

      // Each date is only mentioned once it is inside its own notice window,
      // so a birthday is named a month out and an ordinary appointment is not
      // sitting on the home page for six weeks.
      const custom =
        item.kind === "milestone"
          ? sources.milestones?.find(
              (m) => `milestone-${m.id}` === item.key,
            )?.noticeDays
          : null;

      const notice =
        custom != null && custom > 0 ? custom : DEFAULT_NOTICE[item.kind];

      return item.daysAway <= notice;
    })
    .sort((a, b) => a.daysAway - b.daysAway);
}
