import { describe, expect, it } from "vitest";
import {
  bookStatus,
  endOfDay,
  moveWrites,
  readYear,
  sameYear,
  swapWrites,
  toDateInput,
  yearsLabel,
} from "./memory-book";

describe("putting the pages in order", () => {
  const rows = [
    { id: 10, position: 1 },
    { id: 11, position: 2 },
    { id: 12, position: 3 },
  ];

  it("swaps two neighbours with two writes", () => {
    expect(moveWrites(rows, 12, -1)).toEqual([
      { id: 12, position: 2 },
      { id: 11, position: 3 },
    ]);
  });

  it("does nothing past either end", () => {
    expect(moveWrites(rows, 10, -1)).toEqual([]);
    expect(moveWrites(rows, 12, 1)).toEqual([]);
    expect(moveWrites(rows, 99, 1)).toEqual([]);
  });

  it("still moves rows whose positions tie", () => {
    // Swapping two equal numbers would change nothing; renumbering does.
    const tied = [
      { id: 1, position: 0 },
      { id: 2, position: 0 },
    ];
    const writes = moveWrites(tied, 2, -1);
    expect(writes).toEqual([
      { id: 2, position: 1 },
      { id: 1, position: 2 },
    ]);
  });

  it("renumbers across both kinds of entry when swapping inside one", () => {
    // Memories 1 and 3, a eulogy at 2: moving memory 3 up swaps it with 1.
    const entries = [
      { id: 1, position: 1 },
      { id: 2, position: 2 },
      { id: 3, position: 3 },
    ];
    expect(swapWrites(entries, 3, 1)).toEqual([
      { id: 3, position: 1 },
      { id: 1, position: 3 },
    ]);
  });

  it("only lets a chapter trade places inside its own year", () => {
    const chapters = [
      { id: 1, position: 1, startYear: 1961 },
      { id: 2, position: 2, startYear: 1974 },
      { id: 3, position: 3, startYear: 1974 },
      { id: 4, position: 4, startYear: null },
    ];
    expect(moveWrites(chapters, 2, -1, sameYear)).toEqual([]);
    expect(moveWrites(chapters, 3, -1, sameYear)).toHaveLength(2);
    expect(moveWrites(chapters, 4, -1, sameYear)).toEqual([]);
  });
});

describe("years and dates", () => {
  it("reads a year, a blank, or neither", () => {
    expect(readYear("1974")).toBe(1974);
    expect(readYear("  ")).toBeNull();
    expect(readYear("74")).toBeUndefined();
    expect(readYear("1066")).toBeUndefined();
  });

  it("labels a span the way the book prints it", () => {
    expect(yearsLabel(1961, 1990)).toBe("1961–1990");
    expect(yearsLabel(1961, null)).toBe("1961");
    expect(yearsLabel(null, 1990)).toBe("");
  });

  it("closes at the end of the chosen day and reads it back as that day", () => {
    const iso = endOfDay("2027-03-14");
    expect(iso).not.toBeNull();
    expect(toDateInput(iso)).toBe("2027-03-14");
    expect(endOfDay("14/03/2027")).toBeNull();
  });

  it("closes at midnight in the home's town, not the browser's", () => {
    // 23:59:59 in Denver in March (MDT, UTC-6) is 05:59:59 the next day UTC.
    const iso = endOfDay("2027-03-14", "America/Denver");
    expect(iso).toBe("2027-03-15T05:59:59.000Z");
    expect(toDateInput(iso, "America/Denver")).toBe("2027-03-14");
    // Read in London the same instant is already the fifteenth, which is
    // why the input has to be read on the home's calendar.
    expect(toDateInput(iso, "Europe/London")).toBe("2027-03-15");
  });
});

describe("the status line", () => {
  const format = (date: Date) => date.toISOString().slice(0, 10);

  it("says an open book with no end date is open", () => {
    expect(bookStatus({ open: true, closesAt: null }, format)).toMatch(/^Open/);
  });

  it("names the date on a closing or closed book", () => {
    expect(bookStatus({ open: true, closesAt: "2030-01-02T12:00:00.000Z" }, format)).toBe(
      "Open until 2030-01-02",
    );
    expect(bookStatus({ open: false, closesAt: "2020-01-02T12:00:00.000Z" }, format)).toBe(
      "Closed for printing on 2020-01-02",
    );
  });
});
