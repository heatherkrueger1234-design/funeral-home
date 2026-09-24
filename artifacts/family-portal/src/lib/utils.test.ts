import { describe, expect, it } from "vitest";
import { describeError, formatAtHome } from "./utils";

/**
 * The family is told when to be somewhere, so the hour has to be the funeral
 * home's hour whatever zone the phone reading it is in. 17:00 UTC on a
 * September day is 11 in the morning in Denver.
 */
describe("formatAtHome", () => {
  const service = "2026-09-28T17:00:00.000Z";
  const opts = { hour: "numeric", minute: "2-digit" } as const;

  it("states the time on the home's clock", () => {
    expect(formatAtHome(service, "America/Denver", opts)).toMatch(/11:00/);
  });

  it("names the zone when the reader is somewhere else", () => {
    const reader = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const home = reader === "America/Denver" ? "America/New_York" : "America/Denver";
    expect(formatAtHome(service, home, opts)).toMatch(/[A-Z]{2,4}|GMT/);
  });

  it("leaves dates alone rather than adding a zone to them", () => {
    const text = formatAtHome(service, "America/Denver", {
      day: "numeric",
      month: "long",
    });
    expect(text).toMatch(/28/);
    expect(text).not.toMatch(/MDT|GMT/);
  });

  it("falls back quietly on a zone the browser does not know", () => {
    expect(formatAtHome(service, "Not/AZone", opts)).not.toBe("");
    expect(formatAtHome(null, "America/Denver", opts)).toBe("");
  });
});

describe("describeError", () => {
  const refusal = (status: number, message: string) =>
    Object.assign(new Error(message), { status });

  it("passes the API's own sentence through", () => {
    expect(describeError(refusal(409, "The funeral home already has this one."))).toBe(
      "The funeral home already has this one.",
    );
  });

  it("does not show the browser's words for a dropped connection", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toMatch(/connection/);
  });

  it("does not show a bare status line", () => {
    expect(describeError(refusal(413, "HTTP 413 Payload Too Large"))).toMatch(
      /connection/,
    );
  });
});
