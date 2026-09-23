/**
 * Who a grieving family sees an aftercare check-in come from, and where
 * their reply goes.
 *
 * Both used to be the platform: every home's check-ins arrived from the one
 * SMTP_FROM address, and a family who wrote back "thank you, it was a hard
 * week" was writing to a mailbox at the software company. The message is
 * from their funeral director, so the sender's name and the reply should be
 * the director's too, while the address stays the one SPF and DKIM vouch for.
 *
 * The transport is the only thing faked here: everything up to handing the
 * message to nodemailer is the real run against the real database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const sent = vi.hoisted(() => {
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "apikey";
  process.env["SMTP_PASS"] = "not-a-real-key";
  process.env["SMTP_FROM"] = "Holding Today <care@holding.example>";
  process.env["TASK_SECRET"] = "a-real-secret-value";
  process.env["FAMILY_PORTAL_URL"] = "https://family.example.com";
  return [] as Array<Record<string, unknown>>;
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        sent.push(message);
      },
      verify: async () => true,
    }),
  },
}));

import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

afterAll(() => {
  for (const name of [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "TASK_SECRET",
    "FAMILY_PORTAL_URL",
  ]) {
    delete process.env[name];
  }
});

beforeEach(() => {
  sent.length = 0;
});

/** A closed case whose family said yes, with the 30-day check-in overdue. */
async function homeWithCheckInDue(homeName: string) {
  const staff = await signUpHome(homeName);
  const row = await createCase(staff, {
    serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
  });
  const { token } = await inviteFamily(staff, row.id, {
    email: "anne@example.com",
  });
  await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
  await asFamily(token)
    .post("/api/family/aftercare")
    .send({ consent: true })
    .expect(200);
  return staff;
}

async function runAftercare() {
  // Registering a home sends its own email (the address confirmation); only
  // what the aftercare run sends is under test here.
  sent.length = 0;
  const res = await request(app)
    .post("/api/tasks/aftercare")
    .set("Authorization", "Bearer a-real-secret-value")
    .expect(200);
  expect(res.body.sent).toBe(1);
  expect(sent).toHaveLength(1);
  return sent[0]!;
}

describe("an aftercare check-in", () => {
  it("carries the home's name on the platform's verified address", async () => {
    // A comma and an ampersand: as a formatted string, the comma alone
    // would split this into two senders.
    await homeWithCheckInDue("Horan, McConaty & Sons");

    const message = await runAftercare();

    expect(message["from"]).toEqual({
      name: "Horan, McConaty & Sons",
      address: "care@holding.example",
    });
  });

  it("sends a family's reply to the address the home chose", async () => {
    const staff = await homeWithCheckInDue("Willowbank");
    await staff.agent
      .put("/api/home")
      .send({ intakeNotifyEmail: "office@willowbank.example" })
      .expect(200);

    const message = await runAftercare();

    expect(message["replyTo"]).toBe("office@willowbank.example");
  });

  it("falls back to the owner's own address when the home chose none", async () => {
    await homeWithCheckInDue("Willowbank");

    const message = await runAftercare();

    // signUpHome registers the owner as director<n>@example.com.
    expect(message["replyTo"]).toMatch(/^director\d+@example\.com$/);
  });
});

/**
 * The way out, in the message itself.
 *
 * The portal is where consent was given, but the portal link lives ninety
 * days and the anniversary note lands at a year. CAN-SPAM wants a working
 * unsubscribe and a postal address in every one of these, and so does
 * anybody who opens one on a day they cannot face it.
 */
describe("the foot of a check-in", () => {
  it("carries a working unsubscribe link, the header for it, and the home's address", async () => {
    const staff = await homeWithCheckInDue("Willowbank");
    await staff.agent
      .put("/api/home")
      .send({
        addressLine1: "12 Elm Street",
        city: "Golden",
        region: "CO",
        postalCode: "80401",
      })
      .expect(200);

    const message = await runAftercare();
    const text = String(message["text"]);
    const html = String(message["html"]);

    expect(text).toContain("12 Elm Street, Golden, CO 80401");
    const link = /https:\/\/family\.example\.com\/stop\?token=([^\s]+)/.exec(text);
    expect(link).not.toBeNull();
    expect(html).toContain("stop these notes");

    const headers = message["headers"] as Record<string, string>;
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(headers["List-Unsubscribe"]).toContain(
      "/api/public/aftercare/unsubscribe?token=",
    );

    // And the link does what it says.
    const token = decodeURIComponent(link![1]!);
    await request(app)
      .post("/api/public/aftercare/unsubscribe")
      .query({ token })
      .expect(200);

    const cases = await staff.agent.get("/api/cases").expect(200);
    const seen = await staff.agent
      .get(`/api/cases/${cases.body[0].id}/aftercare`)
      .expect(200);
    expect(seen.body[0].unsubscribedAt).not.toBeNull();
  });

  it("does not assume the person who died was a woman", async () => {
    const staff = await signUpHome("Willowbank");
    const row = await createCase(staff, {
      decedentFirstName: "Walter",
      serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "june@example.com",
    });
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);
    // Opening the book is what makes the check-in invite them to it.
    await asFamily(token).get("/api/family/memory-book").expect(200);

    const message = await runAftercare();
    const text = String(message["text"]);

    expect(text).toContain("book of memories");
    expect(text).not.toMatch(/\bshe\b/);
  });
});
