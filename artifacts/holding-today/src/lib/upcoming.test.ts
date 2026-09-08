import { describe, expect, it, vi, afterEach } from "vitest";
import { computeUpcoming, describeDaysAway, parseLocalDate } from "./upcoming";

afterEach(() => vi.useRealTimers());

/** Freezes "now" at local noon so day arithmetic cannot straddle midnight. */
function freeze(isoDay: string) {
  const [y, m, d] = isoDay.split("-").map(Number);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0));
}

describe("parsing a stored date", () => {
  it("reads it as a local date, not UTC", () => {
    const parsed = parseLocalDate("2002-04-01");
    // Parsed as UTC this renders as 31 March for anyone west of Greenwich.
    // Getting a child's birthday off by a day is not an acceptable rounding.
    expect(parsed?.getFullYear()).toBe(2002);
    expect(parsed?.getMonth()).toBe(3);
    expect(parsed?.getDate()).toBe(1);
  });

  it("returns null for anything it cannot read", () => {
    for (const value of ["", null, undefined, "not a date", "04/01/2002"]) {
      expect(parseLocalDate(value)).toBeNull();
    }
  });
});

describe("what is coming", () => {
  it("finds a birthday that is a few weeks off", () => {
    freeze("2026-03-20");

    const [next] = computeUpcoming({
      childName: "Sam",
      childBirthDate: "2002-04-01",
      includeHolidays: false,
    });

    expect(next.kind).toBe("birthday");
    expect(next.daysAway).toBe(12);
    expect(next.detail).toBe("Sam would have been 24.");
  });

  it("counts the years since, on the angel date", () => {
    freeze("2026-11-01");

    const [next] = computeUpcoming({
      childName: "Sam",
      childPassingDate: "2022-11-08",
      includeHolidays: false,
    });

    expect(next.kind).toBe("angelversary");
    expect(next.title).toBe("Four years");
    expect(next.daysAway).toBe(7);
  });

  it("rolls to next year once the date has passed", () => {
    freeze("2026-05-01");

    const [next] = computeUpcoming({
      childBirthDate: "2002-04-01",
      includeHolidays: false,
    });
    // April is behind us, so nothing is within the horizon.
    expect(next).toBeUndefined();
  });

  it("counts today as today, not as missed", () => {
    freeze("2026-04-01");

    const [next] = computeUpcoming({
      childName: "Sam",
      childBirthDate: "2002-04-01",
      includeHolidays: false,
    });

    expect(next.daysAway).toBe(0);
    expect(describeDaysAway(0)).toBe("Today");
  });

  it("puts the nearest thing first", () => {
    freeze("2026-03-25");

    const items = computeUpcoming({
      childName: "Sam",
      childBirthDate: "2002-04-10",
      childPassingDate: "2022-04-02",
      includeHolidays: false,
    });

    expect(items.map((i) => i.kind)).toEqual(["angelversary", "birthday"]);
  });

  it("includes a dated milestone that is coming, and drops one that has gone", () => {
    freeze("2026-03-01");

    const items = computeUpcoming({
      childName: "Sam",
      includeHolidays: false,
      milestones: [
        { id: 1, title: "Would have graduated", milestoneDate: "2026-03-14" },
        { id: 2, title: "Last Christmas together", milestoneDate: "2021-12-25" },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Would have graduated");
  });

  it("stays quiet when there is nothing near", () => {
    freeze("2026-07-01");

    expect(
      computeUpcoming({
        childName: "Sam",
        childBirthDate: "2002-04-01",
        childPassingDate: "2022-11-08",
        includeHolidays: false,
      }),
    ).toEqual([]);
  });

  it("handles a name ending in s without a stray apostrophe", () => {
    freeze("2026-03-25");

    const [next] = computeUpcoming({
      childName: "James",
      childBirthDate: "2002-04-01",
      includeHolidays: false,
    });

    expect(next.title).toBe("James' birthday");
  });

  it("says nothing about a profile with no dates at all", () => {
    expect(
      computeUpcoming({ childName: "Sam", includeHolidays: false }),
    ).toEqual([]);
  });
});

describe("the days nobody warns you about", () => {
  it("finds Mother's Day without anyone having typed it in", () => {
    freeze("2026-05-01");

    const items = computeUpcoming({ childName: "Sam" });
    const mothersDay = items.find((i) => i.key === "mothers-day");

    // Second Sunday in May 2026 is the 10th.
    expect(mothersDay?.date.getMonth()).toBe(4);
    expect(mothersDay?.date.getDate()).toBe(10);
    expect(mothersDay?.daysAway).toBe(9);
  });

  it("finds Father's Day, which is the third Sunday and not the second", () => {
    freeze("2026-06-10");

    const fathersDay = computeUpcoming({ childName: "Sam" }).find(
      (i) => i.key === "fathers-day",
    );

    // Third Sunday in June 2026 is the 21st.
    expect(fathersDay?.date.getMonth()).toBe(5);
    expect(fathersDay?.date.getDate()).toBe(21);
  });

  it("finds Thanksgiving, which is the fourth Thursday", () => {
    freeze("2026-11-10");

    const thanksgiving = computeUpcoming({ childName: "Sam" }).find(
      (i) => i.key === "thanksgiving",
    );

    // Fourth Thursday in November 2026 is the 26th.
    expect(thanksgiving?.date.getDate()).toBe(26);
  });

  it("rolls a holiday into next year once it has passed", () => {
    freeze("2026-12-26");

    const items = computeUpcoming({ childName: "Sam" });
    // Christmas has gone; New Year's Eve is five days off and Mother's Day is
    // far outside the horizon.
    expect(items.map((i) => i.key)).toContain("new-year");
    expect(items.map((i) => i.key)).not.toContain("christmas");
  });

  it("can be turned off entirely", () => {
    freeze("2026-05-01");

    expect(
      computeUpcoming({ childName: "Sam", includeHolidays: false }),
    ).toEqual([]);
  });
});

describe("how much notice each date gets", () => {
  it("names a birthday a month out, and an ordinary milestone only a fortnight out", () => {
    freeze("2026-03-05");

    const birthday = computeUpcoming({
      childName: "Sam",
      // 29 days away: inside the birthday's month of notice.
      childBirthDate: "2002-04-03",
      includeHolidays: false,
    });
    expect(birthday).toHaveLength(1);

    const milestone = computeUpcoming({
      childName: "Sam",
      includeHolidays: false,
      milestones: [
        // Same 29 days away, but an ordinary dated event: too far to mention.
        { id: 1, title: "Meeting with the lawyer", milestoneDate: "2026-04-03" },
      ],
    });
    expect(milestone).toEqual([]);
  });

  it("respects a notice window set on the milestone itself", () => {
    freeze("2026-03-05");

    const items = computeUpcoming({
      childName: "Sam",
      includeHolidays: false,
      milestones: [
        {
          id: 1,
          title: "His friends graduate",
          milestoneDate: "2026-04-03",
          noticeDays: 40,
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].daysAway).toBe(29);
  });

  it("rolls a recurring milestone forward, and lets a one-off expire", () => {
    freeze("2026-03-01");

    const items = computeUpcoming({
      childName: "Sam",
      includeHolidays: false,
      milestones: [
        {
          id: 1,
          title: "The day we met his teacher",
          milestoneDate: "2019-03-08",
          recurring: true,
        },
        { id: 2, title: "The inquest", milestoneDate: "2024-03-08" },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("The day we met his teacher");
    expect(items[0].daysAway).toBe(7);
  });

  it("marks the heavy dates as heavy so they can be framed differently", () => {
    freeze("2026-03-20");

    const [birthday] = computeUpcoming({
      childName: "Sam",
      childBirthDate: "2002-04-01",
      includeHolidays: false,
    });
    expect(birthday.heavy).toBe(true);

    const [errand] = computeUpcoming({
      childName: "Sam",
      includeHolidays: false,
      milestones: [
        { id: 1, title: "Call the registrar", milestoneDate: "2026-03-25" },
      ],
    });
    expect(errand.heavy).toBe(false);
  });
});
