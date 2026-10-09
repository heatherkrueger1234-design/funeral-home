/**
 * Getting back into a family page from the web, with a code.
 *
 * The text-message link stays the credential; this is the way to a new one
 * when it has been lost. What these tests hold on to is what could go wrong
 * with that door: it must not say who the homes know, must not end a link
 * that is working, must not reopen what a director closed, and must not be
 * guessable or reusable. The mail transport and Twilio are the only things
 * faked.
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
  return { sent: [] as Array<Record<string, unknown>> };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        mail.sent.push(message);
      },
      verify: async () => true,
    }),
  },
}));

import app from "../src/app";
import { db, familyContactsTable, familySignInsTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

let texts: URLSearchParams[] = [];

beforeEach(() => {
  mail.sent.length = 0;
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
  for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
    delete process.env[name];
  }
});

const ask = (identifier: string) =>
  request(app).post("/api/public/family-sign-in").send({ identifier });
const answer = (body: Record<string, unknown>) =>
  request(app).post("/api/public/family-sign-in/verify").send(body);

/** The six digits out of whichever message went out, once it has. */
async function codeSent(): Promise<string> {
  await vi.waitFor(() => expect(mail.sent.length + texts.length).toBeGreaterThan(0));
  const body = mail.sent.length > 0 ? String(mail.sent.at(-1)!["text"]) : String(texts.at(-1)!.get("Body"));
  return /\b(\d{6})\b/.exec(body)![1]!;
}

async function familyWith(contact: Record<string, unknown>, caseFields: Record<string, unknown> = {}) {
  const staff = await signUpHome();
  const made = await createCase(staff, caseFields);
  const invited = await inviteFamily(staff, made.id, contact);
  // Signing the home up and inviting the family sent mail of their own.
  mail.sent.length = 0;
  return { staff, caseId: made.id, ...invited };
}

describe("family sign-in by code", () => {
  it("lets someone back in by email, and the new link works", async () => {
    const family = await familyWith({ email: "Anne@Example.com" });

    const asked = await ask("anne@example.com").expect(202);
    expect(asked.body.kind).toBe("email");

    const code = await codeSent();
    const done = await answer({ challenge: asked.body.challenge, code }).expect(200);

    const session = await asFamily(done.body.token).get("/api/family/session").expect(200);
    expect(session.body.case.displayName).toBe("Margaret Hale");
    // Replacing the link is what it costs; the old one is gone.
    await asFamily(family.token).get("/api/family/session").expect(401);
  });

  it("matches the mobile number however the home typed it, and texts the one on file", async () => {
    await familyWith({ phone: "(303) 555-0199" });

    const asked = await ask("303-555-0199").expect(202);
    expect(asked.body.kind).toBe("phone");

    const code = await codeSent();
    expect(texts[0]!.get("To")).toBe("+13035550199");

    const done = await answer({ challenge: asked.body.challenge, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` }).expect(200);
    await asFamily(done.body.token).get("/api/family/session").expect(200);
  });

  it("answers alike for an address nobody has, and sends nothing", async () => {
    await familyWith({ email: "anne@example.com" });

    const known = await ask("anne@example.com").expect(202);
    const unknown = await ask("stranger@example.com").expect(202);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort());

    await vi.waitFor(() => expect(mail.sent.length).toBe(1));
    await answer({ challenge: unknown.body.challenge, code: "123456" }).expect(400);
  });

  it("does not touch the link someone already has until the code is right", async () => {
    const family = await familyWith({ email: "anne@example.com" });

    const asked = await ask("anne@example.com").expect(202);
    await codeSent();
    await answer({ challenge: asked.body.challenge, code: "000000" }).expect(400);

    await asFamily(family.token).get("/api/family/session").expect(200);
  });

  it("voids a code after five wrong tries, even for the right one", async () => {
    await familyWith({ email: "anne@example.com" });
    const asked = await ask("anne@example.com").expect(202);
    const code = await codeSent();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i += 1) {
      await answer({ challenge: asked.body.challenge, code: wrong }).expect(400);
    }
    await answer({ challenge: asked.body.challenge, code }).expect(400);
  });

  it("spends a code once", async () => {
    await familyWith({ email: "anne@example.com" });
    const asked = await ask("anne@example.com").expect(202);
    const code = await codeSent();

    await answer({ challenge: asked.body.challenge, code }).expect(200);
    await answer({ challenge: asked.body.challenge, code }).expect(400);
  });

  it("refuses a code that has run out", async () => {
    await familyWith({ email: "anne@example.com" });
    const asked = await ask("anne@example.com").expect(202);
    const code = await codeSent();

    await db.update(familySignInsTable).set({ expiresAt: new Date(Date.now() - 1000) });
    await answer({ challenge: asked.body.challenge, code }).expect(400);
  });

  it("does not reopen a link the director stopped", async () => {
    const family = await familyWith({ email: "anne@example.com" });
    await db
      .update(familyContactsTable)
      .set({ revokedAt: new Date() })
      .where(eq(familyContactsTable.id, family.contactId));

    const asked = await ask("anne@example.com").expect(202);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mail.sent).toHaveLength(0);
    await answer({ challenge: asked.body.challenge, code: "123456" }).expect(400);
  });

  it("lets one with an expired link back in", async () => {
    const family = await familyWith({ email: "anne@example.com" });
    await db
      .update(familyContactsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(familyContactsTable.id, family.contactId));
    await asFamily(family.token).get("/api/family/session").expect(401);

    const asked = await ask("anne@example.com").expect(202);
    const code = await codeSent();
    const done = await answer({ challenge: asked.body.challenge, code }).expect(200);
    await asFamily(done.body.token).get("/api/family/session").expect(200);
  });

  it("asks which file when the address is on two, and spends nothing until then", async () => {
    const staff = await signUpHome();
    const mother = await createCase(staff, { decedentFirstName: "Margaret" });
    const father = await createCase(staff, { decedentFirstName: "Walter" });
    const first = await inviteFamily(staff, mother.id, { email: "anne@example.com" });
    const second = await inviteFamily(staff, father.id, { email: "anne@example.com" });
    mail.sent.length = 0;

    const asked = await ask("anne@example.com").expect(202);
    const code = await codeSent();

    const pick = await answer({ challenge: asked.body.challenge, code }).expect(200);
    expect(pick.body.token).toBeUndefined();
    expect(pick.body.choices).toHaveLength(2);
    // Neither link has been touched by being asked.
    await asFamily(first.token).get("/api/family/session").expect(200);
    await asFamily(second.token).get("/api/family/session").expect(200);

    // A choice that is not on the list is refused; one that is, is let in.
    await answer({ challenge: asked.body.challenge, contactId: 999999 }).expect(400);
    const done = await answer({ challenge: asked.body.challenge, contactId: second.contactId }).expect(200);
    const session = await asFamily(done.body.token).get("/api/family/session").expect(200);
    expect(session.body.case.displayName).toBe("Walter Hale");
    await asFamily(first.token).get("/api/family/session").expect(200);
  });

  it("asks for no more than five codes an hour for one address", async () => {
    await familyWith({ email: "anne@example.com" });

    for (let i = 0; i < 7; i += 1) await ask("anne@example.com").expect(202);
    await vi.waitFor(() => expect(mail.sent.length).toBeGreaterThanOrEqual(5));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mail.sent).toHaveLength(5);
  });

  it("does not text a number that has replied STOP", async () => {
    const family = await familyWith({ phone: "3035550199" });
    await db
      .update(familyContactsTable)
      .set({ smsOptedOutAt: new Date() })
      .where(eq(familyContactsTable.id, family.contactId));

    await ask("3035550199").expect(202);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(texts).toHaveLength(0);
  });

  it("turns away something that is neither a number nor an address", async () => {
    await ask("not a thing").expect(400);
    await ask("   ").expect(400);
    await ask("12345").expect(400);
  });

  it("never keeps the code in the clear", async () => {
    await familyWith({ email: "anne@example.com" });
    await ask("anne@example.com").expect(202);
    const code = await codeSent();

    const rows = await db.select().from(familySignInsTable);
    expect(JSON.stringify(rows)).not.toContain(code);
  });
});
