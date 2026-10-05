/**
 * Aftercare by text as well as email, in the home's own words, with the
 * extra notes a family opted in to — and consent read again on the morning
 * each one is due.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

const mail = vi.hoisted(() => {
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "apikey";
  process.env["SMTP_PASS"] = "not-a-real-key";
  process.env["SMTP_FROM"] = "Continuum Aftercare <care@holding.example>";
  process.env["TASK_SECRET"] = "a-real-secret-value";
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

import app from "../src/app";
import {
  db,
  aftercareDeliveriesTable,
  familyContactsTable,
} from "@workspace/db";
import { touchpointDates } from "../src/lib/aftercare";
import { asFamily, createCase, inviteFamily, signUpHome, homesAtMidday } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
let texts: URLSearchParams[] = [];

beforeEach(() => {
  mail.length = 0;
  texts = [];
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC00000000000000000000000000000000");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+13035550100");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
      texts.push(init.body);
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(() => {
  for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "TASK_SECRET"]) {
    delete process.env[name];
  }
});

/** A closed case, service 40 days ago, with the family's answer pending. */
async function closedCase(options: { touchpoints?: string[]; email?: string | null } = {}) {
  const staff = await signUpHome("Aspen Grove");
  if (options.touchpoints) {
    await staff.agent
      .put("/api/home/aftercare")
      .send({ touchpoints: options.touchpoints })
      .expect(200);
  }
  const row = await createCase(staff, {
    serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
    dateOfBirth: "1941-03-19",
    dateOfDeath: new Date(Date.now() - 45 * DAY).toISOString().slice(0, 10),
  });
  const family = await inviteFamily(staff, row.id, {
    email: options.email === undefined ? "anne@example.com" : options.email,
    phone: "303-555-0142",
  });
  await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
  return { staff, row, ...family };
}

async function run() {
  mail.length = 0;
  texts = [];
  await homesAtMidday();
  const res = await request(app)
    .post("/api/tasks/aftercare")
    .set("Authorization", "Bearer a-real-secret-value")
    .expect(200);
  return res.body as { sent: number; texted: number; failed: number; skipped: number };
}

describe("aftercare by text", () => {
  it("records the family's own consent and texts alongside the email", async () => {
    const { token, contactId } = await closedCase();
    const res = await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, sms: true })
      .expect(200);
    expect(res.body.smsConsentAt).not.toBeNull();

    const [contact] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, contactId));
    expect(contact!.smsConsentSource).toBe("family_portal");

    const result = await run();
    expect(result).toMatchObject({ sent: 1, texted: 1 });
    expect(mail).toHaveLength(1);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.get("Body")).toMatch(/^Aspen Grove: It has been a month since Margaret's service\./);
    expect(texts[0]!.get("Body")).toContain("Reply STOP to opt out.");

    const [delivery] = await db
      .select()
      .from(aftercareDeliveriesTable)
      .where(eq(aftercareDeliveriesTable.dayOffset, 30));
    expect(delivery!.sentVia).toBe("email,sms");
  });

  it("can be by text alone, with no email address", async () => {
    const { token } = await closedCase({ email: null });
    await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(400);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, sms: true })
      .expect(200);

    const result = await run();
    expect(result).toMatchObject({ sent: 1, texted: 1 });
    expect(mail).toHaveLength(0);
    expect(texts[0]!.get("Body")).toContain("Thinking of you.");
  });

  it("stops texting the moment they reply STOP, and keeps the email", async () => {
    const { token, contactId } = await closedCase();
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, sms: true })
      .expect(200);
    await db
      .update(familyContactsTable)
      .set({ smsOptedOutAt: new Date() })
      .where(eq(familyContactsTable.id, contactId));

    const result = await run();
    expect(result).toMatchObject({ sent: 1, texted: 0 });
    expect(mail).toHaveLength(1);
    expect(texts).toHaveLength(0);
  });

  it("does not text a family who only said yes to email", async () => {
    const { token } = await closedCase();
    await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(200);
    await run();
    expect(texts).toHaveLength(0);
  });
});

describe("the home's own words", () => {
  it("sends the home's wording, with the name filled in, and can go back to ours", async () => {
    const { staff, token } = await closedCase();
    await staff.agent
      .put("/api/home/aftercare")
      .send({ messages: [{ key: "30", subject: "A month", body: "Thinking of {name} and of you." }] })
      .expect(200);
    await staff.agent
      .put("/api/home/aftercare")
      .send({ messages: [{ key: "60", subject: "Only a subject" }] })
      .expect(400);

    await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(200);
    await run();
    expect(mail[0]!["subject"]).toBe("A month");
    expect(String(mail[0]!["text"])).toContain("Thinking of Margaret and of you.");

    const reset = await staff.agent
      .put("/api/home/aftercare")
      .send({ messages: [{ key: "30", subject: null, body: null }] })
      .expect(200);
    const thirty = reset.body.messages.find((m: { key: string }) => m.key === "30");
    expect(thirty.custom).toBe(false);
    expect(thirty.subject).toBe("Thinking of you");
  });
});

describe("the harder days", () => {
  it("offers only what the home turned on, and schedules them only on a yes", async () => {
    const { token } = await closedCase({ touchpoints: ["birthday", "death_anniversary"] });
    const session = await asFamily(token).get("/api/family/session").expect(200);
    const kinds = session.body.aftercare.touchpointsOffered.map((t: { kind: string }) => t.kind);
    expect(kinds).toEqual(["birthday", "death_anniversary"]);

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, touchpoints: true })
      .expect(200);
    const rows = await db.select().from(aftercareDeliveriesTable);
    expect(rows.map((r) => r.kind).sort()).toEqual([
      "birthday",
      "checkin",
      "checkin",
      "checkin",
      "checkin",
      "death_anniversary",
    ]);
  });

  it("withdraws a touchpoint the home stopped offering before it was due", async () => {
    const { staff, token } = await closedCase({ touchpoints: ["death_anniversary"] });
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true, touchpoints: true })
      .expect(200);
    await staff.agent.put("/api/home/aftercare").send({ touchpoints: [] }).expect(200);

    // Bring the anniversary forward so it is due now.
    await db
      .update(aftercareDeliveriesTable)
      .set({ dueAt: new Date(Date.now() - DAY) })
      .where(eq(aftercareDeliveriesTable.kind, "death_anniversary"));

    await run();
    const [row] = await db
      .select()
      .from(aftercareDeliveriesTable)
      .where(eq(aftercareDeliveriesTable.kind, "death_anniversary"));
    expect(row!.sentVia).toBe("withdrawn");
    expect(mail.every((m) => !String(m["subject"]).includes("Remembering"))).toBe(true);
  });

  it("places each date in the first year and leaves out what it cannot know", () => {
    const start = new Date(Date.UTC(2026, 8, 1));
    const dates = touchpointDates(
      { dateOfBirth: new Date(Date.UTC(1941, 2, 19)), dateOfDeath: new Date(Date.UTC(2026, 7, 25)) },
      start,
      ["birthday", "holidays", "death_anniversary"],
      "America/Denver",
    );
    // Mid-morning in Denver on the day itself: 10:00 MDT is 16:00 UTC in
    // summer, 10:00 MST is 17:00 UTC in winter.
    expect(dates.map((d) => [d.kind, d.dueAt.toISOString()])).toEqual([
      ["birthday", "2027-03-19T16:00:00.000Z"],
      ["holidays", "2026-12-15T17:00:00.000Z"],
      ["death_anniversary", "2027-08-25T16:00:00.000Z"],
    ]);
    expect(
      touchpointDates({ dateOfBirth: null, dateOfDeath: null }, start, ["birthday", "death_anniversary"], "America/Denver"),
    ).toEqual([]);
  });

  it("starts every home on our wording, with no extras offered", async () => {
    const staff = await signUpHome();
    const res = await staff.agent.get("/api/home/aftercare").expect(200);
    expect(res.body.messages).toHaveLength(7);
    expect(res.body.messages.every((m: { custom: boolean }) => !m.custom)).toBe(true);
    expect(res.body.touchpoints).toEqual([]);
  });
});
