import { describe, expect, it } from "vitest";
import { checkInLabel } from "./check-in-label";

describe("checkInLabel", () => {
  it("names the four standard check-ins as the director's settings do", () => {
    expect(checkInLabel({ kind: "checkin", dayOffset: 30 })).toBe("A month on");
    expect(checkInLabel({ kind: "checkin", dayOffset: 365 })).toBe("A year after the service");
  });

  it("names the harder days by what they are, not by their offset", () => {
    expect(checkInLabel({ kind: "birthday", dayOffset: 212 })).toBe("Their birthday");
    expect(checkInLabel({ kind: "death_anniversary", dayOffset: 350 })).toBe("A year since they died");
  });

  it("writes an unusual day as a sentence rather than a day number", () => {
    expect(checkInLabel({ kind: "checkin", dayOffset: 180 })).toBe("Six months after the service");
    expect(checkInLabel({ kind: "checkin", dayOffset: 120 })).toBe("Four months after the service");
    expect(checkInLabel({ kind: "checkin", dayOffset: 45 })).toBe("45 days after the service");
    expect(checkInLabel({ kind: "checkin", dayOffset: 1 })).toBe("1 day after the service");
  });
});
