import { describe, expect, it } from "vitest";
import {
  EULOGY_MAX_LENGTH,
  MEMORY_MAX_LENGTH,
  bodyLimit,
  chapterProblem,
  entryProblem,
  isClosedBook,
  parseYear,
  plainError,
  yearsLabel,
} from "./memory-book";

/**
 * The page's own checks have to agree with the server's, or a family is
 * told "that's fine" and then refused — or, worse, told "too long" about a
 * eulogy the server would have taken. These pin the agreement.
 */

describe("how long a memory can be", () => {
  it("gives a eulogy far more room than a memory", () => {
    expect(bodyLimit("memory")).toBe(MEMORY_MAX_LENGTH);
    expect(bodyLimit("eulogy")).toBe(EULOGY_MAX_LENGTH);
    expect(EULOGY_MAX_LENGTH).toBeGreaterThan(MEMORY_MAX_LENGTH);
  });

  it("refuses an empty one and measures after trimming", () => {
    expect(entryProblem("memory", "   \n ")).not.toBeNull();
    expect(entryProblem("memory", `  ${"a".repeat(MEMORY_MAX_LENGTH)}  `)).toBeNull();
  });

  it("points somebody with a long memory at the eulogy option", () => {
    const long = "a".repeat(MEMORY_MAX_LENGTH + 1);
    expect(entryProblem("memory", long)).toMatch(/read at the service/);
    expect(entryProblem("eulogy", long)).toBeNull();
    expect(entryProblem("eulogy", "a".repeat(EULOGY_MAX_LENGTH + 1))).not.toBeNull();
  });
});

describe("years", () => {
  it("takes a blank as unknown and a four-digit year as a year", () => {
    expect(parseYear("")).toEqual({ ok: true, value: null });
    expect(parseYear(" 1974 ")).toEqual({ ok: true, value: 1974 });
  });

  it("says so about anything the server would refuse", () => {
    expect(parseYear("74").ok).toBe(false);
    expect(parseYear("1974-06-01").ok).toBe(false);
    expect(parseYear("1074").ok).toBe(false);
    expect(parseYear("20226").ok).toBe(false);
  });

  it("labels a chapter the way the printed book does", () => {
    expect(yearsLabel(1961, null)).toBe("1961");
    expect(yearsLabel(1961, 1961)).toBe("1961");
    expect(yearsLabel(1961, 1990)).toBe("1961–1990");
    expect(yearsLabel(null, 1990)).toBeNull();
  });
});

describe("a chapter", () => {
  const blank = { title: "", body: "", startYear: null, endYear: null };

  it("needs a title, a year, or some words", () => {
    expect(chapterProblem(blank)).not.toBeNull();
    expect(chapterProblem({ ...blank, title: "Married" })).toBeNull();
    expect(chapterProblem({ ...blank, startYear: 1961 })).toBeNull();
    expect(chapterProblem({ ...blank, body: "They kept bees." })).toBeNull();
  });

  it("cannot end before it starts, or end without starting", () => {
    expect(chapterProblem({ ...blank, startYear: 1990, endYear: 1961 })).toMatch(/ends before/);
    expect(chapterProblem({ ...blank, title: "Cedar Street", endYear: 1990 })).not.toBeNull();
    expect(chapterProblem({ ...blank, startYear: 1961, endYear: 1990 })).toBeNull();
  });
});

describe("errors", () => {
  it("shows the server's sentence without the status line", () => {
    const error = Object.assign(
      new Error("HTTP 409 Conflict: This book has been closed for printing."),
      { status: 409 },
    );
    expect(plainError(error)).toBe("This book has been closed for printing.");
    expect(isClosedBook(error)).toBe(true);
    expect(isClosedBook(Object.assign(new Error("x"), { status: 400 }))).toBe(false);
  });
});
