import { describe, expect, it } from "vitest";
import {
  browserZone,
  formatAtHome,
  formatCalendarDate,
  fromHomeInput,
  homeDayNumber,
  toHomeInput,
} from "./utils";

/**
 * The console reads and writes every time on the home's clock, whatever zone
 * the laptop is in. 17:00 UTC on a September day is eleven in the morning in
 * Denver and one in the afternoon in New York.
 */
const service = "2026-09-28T17:00:00.000Z";
const time = { hour: "numeric", minute: "2-digit" } as const;
/** A zone guaranteed not to be the one these tests run in. */
const elsewhere =
  browserZone() === "America/Denver" ? "America/New_York" : "America/Denver";

describe("formatAtHome", () => {
  it("states the time on the home's clock", () => {
    expect(formatAtHome(service, "America/Denver", time)).toMatch(/11:00/);
    expect(formatAtHome(service, "America/New_York", time)).toMatch(/1:00/);
  });

  it("names the zone when the reader is somewhere else, and not otherwise", () => {
    expect(formatAtHome(service, elsewhere, time)).toMatch(/[A-Z]{2,4}|GMT/);
    expect(formatAtHome(service, browserZone(), time)).not.toMatch(
      /[A-Z]{3,4}$|GMT/,
    );
  });

  it("never moves a bare date, whichever zone the home is in", () => {
    for (const zone of ["America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
      const text = formatAtHome("1942-03-04", zone, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      expect(text).toMatch(/4/);
      expect(text).toMatch(/1942/);
      expect(text).not.toMatch(/\b3\b/);
    }
  });

  it("falls back quietly on a zone the browser does not know", () => {
    expect(formatAtHome(service, "Not/AZone", time)).not.toBe("");
    expect(formatAtHome(null, "America/Denver", time)).toBe("");
    expect(formatAtHome("not a date", "America/Denver", time)).toBe("");
  });
});

describe("formatCalendarDate", () => {
  it("reads a midnight-UTC fact as the day it was typed", () => {
    // A date of death picked in a date input and stored as midnight UTC.
    const text = formatCalendarDate("2026-09-20T00:00:00.000Z", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
    });
    expect(text).toMatch(/Sunday/);
    expect(text).toMatch(/20/);
    expect(text).not.toMatch(/:/);
  });
});

describe("datetime-local inputs on the home's clock", () => {
  it("shows an instant as the home's wall time", () => {
    expect(toHomeInput(service, "America/Denver")).toBe("2026-09-28T11:00");
    expect(toHomeInput(service, "America/New_York")).toBe("2026-09-28T13:00");
  });

  it("reads what was typed as the home's wall time, not the laptop's", () => {
    expect(fromHomeInput("2026-09-28T11:00", "America/Denver")).toBe(service);
    expect(fromHomeInput("2026-09-28T13:00", "America/New_York")).toBe(service);
  });

  it("round-trips across a daylight-saving change", () => {
    // The first Sunday of November: 01:30 happens twice in Denver, 11:00 once.
    const typed = "2026-11-01T11:00";
    const stored = fromHomeInput(typed, "America/Denver")!;
    expect(stored).toBe("2026-11-01T18:00:00.000Z");
    expect(toHomeInput(stored, "America/Denver")).toBe(typed);

    const spring = fromHomeInput("2026-03-08T11:00", "America/Denver")!;
    expect(spring).toBe("2026-03-08T17:00:00.000Z");
  });

  it("refuses what is not a datetime", () => {
    expect(fromHomeInput("", "America/Denver")).toBeNull();
    expect(toHomeInput(null, "America/Denver")).toBe("");
  });
});

describe("homeDayNumber", () => {
  it("counts the day at the home, not in UTC", () => {
    // Eleven at night in Denver is already the next day in UTC.
    const late = "2026-09-29T05:00:00.000Z";
    const morning = "2026-09-28T15:00:00.000Z";
    expect(homeDayNumber(late, "America/Denver")).toBe(
      homeDayNumber(morning, "America/Denver"),
    );
    expect(homeDayNumber(late, "UTC")).toBe(homeDayNumber(morning, "UTC") + 1);
  });
});
