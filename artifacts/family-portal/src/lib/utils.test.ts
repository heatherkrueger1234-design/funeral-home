import { describe, expect, it } from "vitest";
import { cn, formatDate, formatDateTime } from "./utils";

describe("formatDate", () => {
  it("formats an ISO date as a long-form date", () => {
    expect(formatDate("2026-03-14")).toBe("March 14th, 2026");
  });

  it("returns an empty string for null or undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("falls back to the raw string rather than throwing on unparseable input", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDateTime", () => {
  it("formats an ISO timestamp as a long-form date and time", () => {
    expect(formatDateTime("2026-03-14T18:30:00.000Z")).toMatch(
      /^March 14th, 2026 at \d{1,2}:\d{2} (AM|PM)$/,
    );
  });

  it("returns an empty string for null or undefined", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime(undefined)).toBe("");
  });
});

describe("cn", () => {
  it("merges class names and lets a later Tailwind utility win", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});
