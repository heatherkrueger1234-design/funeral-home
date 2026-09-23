import { describe, it, expect } from "vitest";
import { db, funeralHomesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import request from "supertest";
import app from "../src/app";
import { runTrialReminders } from "../src/lib/trial-reminders";
import { signUpHome, type StaffSession } from "./helpers";

/**
 * Telling a funeral home where it stands with its trial.
 *
 * The least glamorous behaviour in the repository and the one that decides
 * whether any of the rest gets paid for. Before it existed the only notice a
 * home ever got was a banner in a console, so a proprietor who set the product
 * up, used it for three real funerals and then did not sign in for three weeks
 * found out the trial had ended by being refused a case on the morning somebody
 * died.
 *
 * What these tests are mostly about is the ways a reminder job goes wrong:
 * sending twice, sending to somebody who has already paid, and sending nothing
 * at all.
 */

/** Move a home's trial end to `days` from now. Negative means it has passed. */
async function trialEndsIn(staff: StaffSession, days: number): Promise<void> {
  await db
    .update(funeralHomesTable)
    .set({ trialEndsAt: new Date(Date.now() + days * 86400000) })
    .where(eq(funeralHomesTable.id, staff.homeId));
}

async function remindersSent(staff: StaffSession): Promise<string> {
  const [home] = await db
    .select({ sent: funeralHomesTable.trialRemindersSent })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, staff.homeId));
  return home!.sent;
}

describe("when a reminder is due", () => {
  it("says nothing while the trial has weeks to run", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await trialEndsIn(staff, 20);

    const result = await runTrialReminders();

    expect(result.due).toBe(0);
    expect(result.sent).toBe(0);
    expect(await remindersSent(staff)).toBe("");
  });

  it("gives a week's notice, then a day's, then one note on the day", async () => {
    const staff = await signUpHome("Aspen & Vale");

    await trialEndsIn(staff, 6);
    expect((await runTrialReminders()).sent).toBe(1);
    expect(await remindersSent(staff)).toBe("trial-7");

    await trialEndsIn(staff, 1);
    expect((await runTrialReminders()).sent).toBe(1);
    expect(await remindersSent(staff)).toBe("trial-7,trial-1");

    await trialEndsIn(staff, -1);
    expect((await runTrialReminders()).sent).toBe(1);
    expect(await remindersSent(staff)).toBe("trial-7,trial-1,trial-ended");
  });

  it("never sends the same reminder twice, however often it runs", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await trialEndsIn(staff, 3);

    expect((await runTrialReminders()).sent).toBe(1);

    /*
     * The thing being protected is not a checkbox. It is a proprietor
     * receiving the same "your trial ends on Tuesday" email four times because
     * a scheduler fired four times, which reads as broken software from the
     * company holding their families' photographs.
     */
    for (let run = 0; run < 3; run += 1) {
      const again = await runTrialReminders();
      expect(again.due).toBe(0);
      expect(again.sent).toBe(0);
    }

    /*
     * `trial-7` rather than `trial-1`: three days out, the milestone still
     * unsaid is the week's notice. The key is only bookkeeping — the email
     * itself counts the days live, so it reads "ends in 3 days" and is true.
     */
    expect(await remindersSent(staff)).toBe("trial-7");
  });

  it("sends the one that is still true after a long gap, not a stale one", async () => {
    const staff = await signUpHome("Aspen & Vale");

    /*
     * Nobody ran the job for a fortnight. A week's notice expired days ago and
     * saying it now would be wrong; what the proprietor needs to read is that
     * the trial has ended.
     */
    await trialEndsIn(staff, -2);

    expect((await runTrialReminders()).sent).toBe(1);
    expect(await remindersSent(staff)).toBe("trial-ended");
  });

  it("says nothing to a home that has already subscribed", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await trialEndsIn(staff, 1);

    await db
      .update(funeralHomesTable)
      .set({ subscriptionStatus: "active" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    // Nobody who has paid should ever read a message about their trial ending.
    const result = await runTrialReminders();

    expect(result.due).toBe(0);
    expect(await remindersSent(staff)).toBe("");
  });

  it("says nothing to a suspended home, or to one of ours", async () => {
    const suspended = await signUpHome("Oakwood Chapel");
    await trialEndsIn(suspended, 1);
    await db
      .update(funeralHomesTable)
      .set({ suspendedAt: new Date(), suspendedReason: "Under review" })
      .where(eq(funeralHomesTable.id, suspended.homeId));

    const ours = await signUpHome("Holding Today Ltd");
    await trialEndsIn(ours, 1);
    await db
      .update(funeralHomesTable)
      .set({ internalAccount: true })
      .where(eq(funeralHomesTable.id, ours.homeId));

    const result = await runTrialReminders();

    expect(result.due).toBe(0);
    expect(await remindersSent(suspended)).toBe("");
    expect(await remindersSent(ours)).toBe("");
  });

  it("says nothing to a home whose owner has been deactivated", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await trialEndsIn(staff, 1);

    await db
      .update(usersTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(usersTable.id, staff.userId));

    expect((await runTrialReminders()).due).toBe(0);
  });
});

describe("the dry run", () => {
  it("reports what is due and marks nothing", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await trialEndsIn(staff, 1);

    const dry = await runTrialReminders({ dryRun: true });

    expect(dry.due).toBe(1);
    expect(dry.sent).toBe(0);
    expect(dry.dryRun).toBe(true);
    // The point: checking a new deployment is wired up without writing to a
    // customer, and without burning the reminder they still need.
    expect(await remindersSent(staff)).toBe("");

    expect((await runTrialReminders()).sent).toBe(1);
  });
});

describe("the endpoint", () => {
  it("refuses a request with no secret", async () => {
    await request(app).post("/api/tasks/trial-reminders").expect(503);
  });

  it("runs when the secret matches, and refuses when it does not", async () => {
    const previous = process.env["TASK_SECRET"];
    process.env["TASK_SECRET"] = "a-shared-secret-for-the-scheduler";

    try {
      await request(app)
        .post("/api/tasks/trial-reminders")
        .set("Authorization", "Bearer the-wrong-secret-entirely")
        .expect(401);

      const res = await request(app)
        .post("/api/tasks/trial-reminders?dryRun=1")
        .set("Authorization", "Bearer a-shared-secret-for-the-scheduler")
        .expect(200);

      expect(res.body).toMatchObject({ dryRun: true, due: 0, sent: 0 });
    } finally {
      if (previous === undefined) delete process.env["TASK_SECRET"];
      else process.env["TASK_SECRET"] = previous;
    }
  });
});
