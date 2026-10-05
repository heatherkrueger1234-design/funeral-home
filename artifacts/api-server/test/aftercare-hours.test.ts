/**
 * When a check-in actually leaves.
 *
 * The sender used to run once a day at 14:00 UTC — six in the morning in
 * Oregon — and anything that fell due later in the day waited for the next
 * run, so "Today would have been her birthday" arrived the day after it.
 * It now runs hourly and sends only between nine and seven where the home
 * is; these tests hold both halves of that.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { aftercareDeliveriesTable, db, funeralHomesTable } from "@workspace/db";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, middayZone, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/** A zone where it is three in the morning right now. */
function threeAmZone(now = new Date()): string {
  const ahead = (((3 - now.getUTCHours()) % 24) + 24) % 24;
  const offset = ahead > 12 ? ahead - 24 : ahead;
  if (offset === 0) return "Etc/GMT";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

beforeEach(() => {
  vi.stubEnv("TASK_SECRET", "a-real-secret-value");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function dueCheckIn() {
  const staff = await signUpHome("Aspen Grove");
  const row = await createCase(staff, {
    serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
  });
  const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });
  await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
  await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(200);
  return staff;
}

const run = () =>
  request(app)
    .post("/api/tasks/aftercare?dryRun=1")
    .set("Authorization", "Bearer a-real-secret-value")
    .expect(200);

describe("the hours a check-in may leave", () => {
  it("waits, rather than sending, while it is the middle of the night at the home", async () => {
    const staff = await dueCheckIn();
    await db
      .update(funeralHomesTable)
      .set({ timezone: threeAmZone() })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const night = await run();
    expect(night.body.due).toBe(0);

    // And it is still owed: the next run in the morning finds it.
    await db
      .update(funeralHomesTable)
      .set({ timezone: middayZone() })
      .where(eq(funeralHomesTable.id, staff.homeId));
    const morning = await run();
    expect(morning.body.due).toBe(1);
  });

  it("falls due at mid-morning on the day, where the home is", async () => {
    await dueCheckIn();
    const rows = await db.select().from(aftercareDeliveriesTable);
    const hours = new Set(
      rows.map((row) =>
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver",
          hour: "numeric",
          hourCycle: "h23",
        }).format(row.dueAt),
      ),
    );
    expect([...hours]).toEqual(["10"]);
  });
});
