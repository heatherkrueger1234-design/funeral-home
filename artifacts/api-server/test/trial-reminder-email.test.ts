/**
 * What a trial reminder says, read from the message handed to the mail
 * server. The transport is the only thing faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mail = vi.hoisted(() => {
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "apikey";
  process.env["SMTP_PASS"] = "not-a-real-key";
  process.env["SMTP_FROM"] = "Continuum Aftercare <care@holding.example>";
  return [] as Array<Record<string, unknown>>;
});

/** Addresses the mail server refuses, as a provider does in an outage. */
const refused = vi.hoisted(() => new Set<string>());

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        if (refused.has(String(message["to"]))) {
          throw new Error("421 Service not available, try again later");
        }
        mail.push(message);
      },
      verify: async () => true,
    }),
  },
}));

import { db, funeralHomesTable, usersTable } from "@workspace/db";
import { runTrialReminders } from "../src/lib/trial-reminders";
import { signUpHome } from "./helpers";

beforeEach(() => {
  mail.length = 0;
  refused.clear();
});

describe("a trial reminder", () => {
  it("says today on the day it ends, and has ended only once it has", async () => {
    const staff = await signUpHome("Aspen & Vale");
    await db
      .update(funeralHomesTable)
      .set({ timezone: "America/Denver", trialEndsAt: new Date("2026-11-04T20:00:00Z") })
      .where(eq(funeralHomesTable.id, staff.homeId));
    mail.length = 0;

    // Nobody ran the job for a week, so the first run is on the last morning.
    await runTrialReminders({ now: new Date("2026-11-04T15:00:00Z") });
    expect(mail).toHaveLength(1);
    expect(mail[0]!["subject"]).toBe("Aspen & Vale: your trial ends today");
    expect(String(mail[0]!["text"])).toContain("The trial for Aspen & Vale ends today.");

    await runTrialReminders({ now: new Date("2026-11-04T21:00:00Z") });
    expect(mail).toHaveLength(2);
    expect(mail[1]!["subject"]).toBe("Aspen & Vale: your trial has ended");
  });

  it("gives a reminder back when the mail server refuses it, and carries on with the next home", async () => {
    const refusedHome = await signUpHome("Oakwood Chapel");
    const nextHome = await signUpHome("Aspen & Vale");
    for (const staff of [refusedHome, nextHome]) {
      await db
        .update(funeralHomesTable)
        .set({ trialEndsAt: new Date(Date.now() + 3 * 86400000) })
        .where(eq(funeralHomesTable.id, staff.homeId));
    }
    const [owner] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, refusedHome.userId));
    refused.add(owner!.email);
    mail.length = 0;

    const result = await runTrialReminders();

    /*
     * Recorded as sent and never delivered was the one outcome this job
     * exists to prevent: the home hears nothing, and no later run tries
     * again. And the refusal stopped the run there, so every home after it
     * heard nothing either.
     */
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(mail).toHaveLength(1);
    const sentNow = async (homeId: number) =>
      (
        await db
          .select({ sent: funeralHomesTable.trialRemindersSent })
          .from(funeralHomesTable)
          .where(eq(funeralHomesTable.id, homeId))
      )[0]!.sent;
    expect(await sentNow(refusedHome.homeId)).toBe("");
    expect(await sentNow(nextHome.homeId)).toBe("trial-7");

    // The next run, with the server answering again, sends it.
    refused.clear();
    const retried = await runTrialReminders();
    expect(retried.sent).toBe(1);
    expect(await sentNow(refusedHome.homeId)).toBe("trial-7");
  });
});
