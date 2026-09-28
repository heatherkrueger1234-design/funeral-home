import { test } from "node:test";
import assert from "node:assert/strict";
import { localHour, wallClock } from "./wall-clock";

const DENVER = "America/Denver";

test("lands on the asked-for hour whatever time the seed runs", () => {
  // Every hour of one day, in both daylight-saving halves of the year.
  for (const base of ["2026-01-15T00:00:00Z", "2026-07-15T00:00:00Z"]) {
    for (let h = 0; h < 24; h += 1) {
      const now = new Date(new Date(base).getTime() + h * 3_600_000);
      for (const hour of [9, 11, 14, 17]) {
        assert.equal(localHour(wallClock(now, 4, hour), DENVER), hour);
      }
    }
  }
});

test("keeps minutes and moves by whole calendar days", () => {
  const now = new Date("2026-09-28T20:00:00Z");
  const a = wallClock(now, 0, 10, 30);
  const b = wallClock(now, 1, 10, 30);
  assert.equal(b.getTime() - a.getTime(), 24 * 3_600_000);
  assert.equal(a.toISOString(), "2026-09-28T16:30:00.000Z");
});

test("survives the spring-forward day", () => {
  const now = new Date("2026-03-07T18:00:00Z");
  const service = wallClock(now, 1, 11); // 8 March 2026, DST begins at 2am
  assert.equal(service.toISOString(), "2026-03-08T17:00:00.000Z");
});
