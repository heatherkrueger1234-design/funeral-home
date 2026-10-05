/**
 * How many emails one address can be made to receive.
 *
 * "Somebody tried to register with this address", a password reset and a
 * confirmation link each go because somebody asked, and for the first two
 * anybody can ask, about any address. The only limit was per caller, so a
 * few callers taking turns could fill a stranger's inbox from our domain
 * until the mail provider suspended it for every home. Each address now has
 * ceilings of its own, and reaching one changes nothing about the answer.
 * The transport is the only thing faked here.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
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
        // A mail server that never answers.
        if (mail.hang) await new Promise(() => {});
      },
      verify: async () => true,
    }),
  },
}));

import app from "../src/app";
import {
  db,
  emailVerificationsTable,
  passwordResetsTable,
  sentEmailsTable,
  type SentEmailKind,
} from "@workspace/db";
import { logger } from "../src/lib/logger";
import { signUpHome } from "./helpers";

const ACCOUNT_EXISTS = "About your Continuum Aftercare account";
const RESET = "Reset your Continuum Aftercare password";

let warn: MockInstance;

beforeEach(() => {
  mail.sent.length = 0;
  mail.hang = false;
  warn = vi.spyOn(logger, "warn");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sentTo(address: string, subject: string) {
  return mail.sent.filter((message) => message["to"] === address && message["subject"] === subject);
}

/** How many of this kind were held back, from the log line that says so. */
function heldBack(kind: SentEmailKind): number {
  return warn.mock.calls.filter(([fields]) => (fields as { kind?: string } | undefined)?.kind === kind)
    .length;
}

/** Until each email asked for has either gone or been held back. */
async function settle(asked: number, address: string, subject: string, kind: SentEmailKind) {
  await vi.waitFor(() => expect(sentTo(address, subject).length + heldBack(kind)).toBe(asked));
}

function registerAgain(email: string) {
  return request(app)
    .post("/api/auth/register")
    .send({ homeName: "Somebody Else's Chapel", email, password: "a-different-password" });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

describe("an address that already has an account", () => {
  it("is told three times in an hour, then sent nothing, and answered the same every time", async () => {
    const staff = await signUpHome();

    const answers = [];
    for (const typed of [staff.email, staff.email, staff.email.toUpperCase(), staff.email]) {
      answers.push(await registerAgain(typed).expect(202));
    }
    await settle(4, staff.email, ACCOUNT_EXISTS, "account_exists");

    expect(sentTo(staff.email, ACCOUNT_EXISTS)).toHaveLength(3);
    for (const res of answers) {
      expect(res.body).toEqual(answers[0]!.body);
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
    // Held back without writing down whose inbox it was.
    expect(heldBack("account_exists")).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(staff.email);
  });

  it("is answered without waiting on the mail server", async () => {
    const staff = await signUpHome();
    mail.hang = true;

    // An answer that waited only when the email went would say when the
    // ceiling had been reached. With the send awaited, this never came back.
    await registerAgain(staff.email).expect(202);
  });

  it("counts each address on its own, and each kind of email on its own", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");

    for (let i = 0; i < 4; i++) await registerAgain(a.email).expect(202);
    await settle(4, a.email, ACCOUNT_EXISTS, "account_exists");

    await registerAgain(b.email).expect(202);
    await request(app).post("/api/auth/forgot-password").send({ email: a.email }).expect(202);
    await vi.waitFor(() => {
      expect(sentTo(b.email, ACCOUNT_EXISTS)).toHaveLength(1);
      expect(sentTo(a.email, RESET)).toHaveLength(1);
    });
    expect(sentTo(a.email, ACCOUNT_EXISTS)).toHaveLength(3);
  });

  it("holds to a day's ceiling once the hour's is clear, and forgets after two days", async () => {
    const staff = await signUpHome();
    // Five earlier today, none of them this hour; and somebody else's, from
    // three days ago, which nothing counts any more.
    await db.insert(sentEmailsTable).values([
      ...[2, 3, 4, 5, 6].map((hours) => ({
        recipientHash: sha256(staff.email),
        kind: "account_exists",
        sentAt: hoursAgo(hours),
      })),
      { recipientHash: sha256("long.gone@example.com"), kind: "password_reset", sentAt: hoursAgo(72) },
    ]);

    await registerAgain(staff.email).expect(202);
    await registerAgain(staff.email).expect(202);
    await settle(2, staff.email, ACCOUNT_EXISTS, "account_exists");

    // The sixth of the day goes, though the hour has had none; the seventh
    // does not, though the hour has had one.
    expect(sentTo(staff.email, ACCOUNT_EXISTS)).toHaveLength(1);
    const kept = await db.select().from(sentEmailsTable);
    expect(kept.filter((row) => row.sentAt < hoursAgo(48))).toEqual([]);
  });
});

describe("password resets", () => {
  it("go five times in an hour, then not at all, answered 202 every time", async () => {
    const staff = await signUpHome();

    for (let i = 0; i < 6; i++) {
      await request(app).post("/api/auth/forgot-password").send({ email: staff.email }).expect(202);
    }
    await settle(6, staff.email, RESET, "password_reset");

    expect(sentTo(staff.email, RESET)).toHaveLength(5);
    // And no sixth link was made, to sit unsent.
    const issued = await db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, staff.userId));
    expect(issued).toHaveLength(5);
  });

  it("go five times when ten are asked for at once", async () => {
    const staff = await signUpHome();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post("/api/auth/forgot-password").send({ email: staff.email }).expect(202),
      ),
    );
    await settle(10, staff.email, RESET, "password_reset");

    expect(sentTo(staff.email, RESET)).toHaveLength(5);
  });
});

describe("confirmation links", () => {
  it("go five times in an hour, the first at registration, then not at all", async () => {
    const staff = await signUpHome("Aspen Grove", { verified: false });
    const subject = "Confirm your address for Aspen Grove";

    for (let i = 0; i < 5; i++) {
      await staff.agent.post("/api/auth/resend-verification").expect(204);
    }
    await settle(6, staff.email, subject, "email_verification");

    expect(sentTo(staff.email, subject)).toHaveLength(5);
    const issued = await db
      .select()
      .from(emailVerificationsTable)
      .where(eq(emailVerificationsTable.userId, staff.userId));
    expect(issued).toHaveLength(5);
  });
});

describe("what is kept", () => {
  it("is a digest of the address, never the address", async () => {
    const staff = await signUpHome();
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: staff.email.toUpperCase() })
      .expect(202);
    await vi.waitFor(() => expect(sentTo(staff.email, RESET)).toHaveLength(1));

    const rows = await db.select().from(sentEmailsTable);
    expect(rows.map((row) => [row.recipientHash, row.kind]).sort()).toEqual([
      [sha256(staff.email), "email_verification"],
      [sha256(staff.email), "password_reset"],
    ]);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(staff.email.split("@")[0]);
    expect(stored).not.toContain("example.com");
  });
});
