import { describe, expect, it } from "vitest";
import { nextDue } from "./next-due";

const now = new Date("2026-09-24T12:00:00Z").getTime();
const entry = (dueAt: string, extra: Partial<{ isEvent: boolean; completedAt: string | null; title: string }> = {}) => ({
  dueAt,
  isEvent: false,
  completedAt: null,
  title: dueAt,
  ...extra,
});

describe("nextDue", () => {
  it("shows the soonest thing still ahead, not yesterday's", () => {
    const result = nextDue(
      [
        entry("2026-09-23T20:00:00Z", { title: "slipped" }),
        entry("2026-09-26T16:00:00Z", { title: "later" }),
        entry("2026-09-25T16:00:00Z", { title: "soonest" }),
      ],
      now,
    );
    expect(result.next?.title).toBe("soonest");
    expect(result.ahead).toBe(true);
    expect(result.slipped.map((e) => e.title)).toEqual(["slipped"]);
  });

  it("falls back to the earliest slipped item when nothing is ahead", () => {
    const result = nextDue(
      [entry("2026-09-23T20:00:00Z", { title: "b" }), entry("2026-09-22T20:00:00Z", { title: "a" })],
      now,
    );
    expect(result.next?.title).toBe("a");
    expect(result.ahead).toBe(false);
  });

  it("never offers the service itself, or anything already done", () => {
    const result = nextDue(
      [
        entry("2026-09-28T16:00:00Z", { isEvent: true }),
        entry("2026-09-25T16:00:00Z", { completedAt: "2026-09-24T10:00:00Z" }),
      ],
      now,
    );
    expect(result.next).toBeUndefined();
    expect(result.slipped).toEqual([]);
  });
});
