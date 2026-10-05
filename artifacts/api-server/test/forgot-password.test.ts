/**
 * "Forgot your password?", which anybody can ask about any address.
 *
 * It answers the same 202 whoever is asked about, so it cannot be used to
 * learn which addresses have accounts. It used to answer after a round trip
 * to the mail server when there was an account, and at once when there was
 * not, so the time it took said what the status would not. The transport is
 * the only thing faked here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

const mail = vi.hoisted(() => {
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "apikey";
  process.env["SMTP_PASS"] = "not-a-real-key";
  process.env["SMTP_FROM"] = "Continuum Aftercare <care@holding.example>";
  return { sent: [] as Array<Record<string, unknown>>, hang: false };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        mail.sent.push(message);
        // A mail server that takes its time -- or never answers.
        if (mail.hang) await new Promise(() => {});
      },
      verify: async () => true,
    }),
  },
}));

import app from "../src/app";
import { db, passwordResetsTable } from "@workspace/db";
import { signUpHome } from "./helpers";

beforeEach(() => {
  mail.sent.length = 0;
  mail.hang = false;
});

describe("forgot password", () => {
  it("answers without waiting on the mail server", async () => {
    const staff = await signUpHome();
    mail.hang = true;

    // With the send awaited, this never came back at all.
    await request(app).post("/api/auth/forgot-password").send({ email: staff.email }).expect(202);
  });

  it("sends a working link to an account, and nothing for an address with none", async () => {
    const staff = await signUpHome();
    mail.sent.length = 0;

    await request(app).post("/api/auth/forgot-password").send({ email: "nobody@example.com" }).expect(202);
    await request(app).post("/api/auth/forgot-password").send({ email: staff.email }).expect(202);

    await vi.waitFor(() => expect(mail.sent).toHaveLength(1));
    expect(mail.sent[0]!["to"]).toBe(staff.email);

    const issued = await db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, staff.userId));
    expect(issued).toHaveLength(1);
  });
});
