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

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        mail.push(message);
      },
      verify: async () => true,
    }),
  },
}));

import { db, funeralHomesTable } from "@workspace/db";
import { runTrialReminders } from "../src/lib/trial-reminders";
import { signUpHome } from "./helpers";

beforeEach(() => {
  mail.length = 0;
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
});
