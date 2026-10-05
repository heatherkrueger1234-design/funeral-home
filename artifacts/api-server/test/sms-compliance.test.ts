import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  familyContactsTable,
  funeralHomesTable,
  platformAdminsTable,
  smsOptOutsTable,
} from "@workspace/db";
import app from "../src/app";
import { keywordOf, revokesConsent, smsRouteFor, twilioSignature } from "../src/lib/sms";
import { createCase, markEmailVerified, signUpHome } from "./helpers";

/**
 * Texting rules a carrier, a regulator and a grieving family all care about:
 * nobody is texted without recorded consent, STOP is honoured for good, and
 * replies are only believed when Twilio signed them.
 */

const TOKEN = "twilio-auth-token";
const HOOK = "https://api.example.test/api/webhooks/twilio/sms";

type Sent = { url: string; body: URLSearchParams };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC00000000000000000000000000000000");
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("TWILIO_FROM_NUMBER", "+13035550100");
  vi.stubEnv("TWILIO_WEBHOOK_URL", HOOK);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: URLSearchParams }) => {
      sent.push({ url, body: init.body });
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function contact(
  staff: Awaited<ReturnType<typeof signUpHome>>,
  extra: Record<string, unknown> = {},
) {
  const row = await createCase(staff);
  const res = await staff.agent
    .post(`/api/cases/${row.id}/contacts`)
    .send({ name: "Anne Hale", phone: "(303) 555-0142", ...extra })
    .expect(201);
  return res.body as { id: number; smsConsentAt: string | null; smsConsentSource: string | null };
}

function inbound(params: Record<string, string>, signature?: string) {
  return request(app)
    .post("/api/webhooks/twilio/sms")
    .type("form")
    .set("X-Twilio-Signature", signature ?? twilioSignature(TOKEN, HOOK, params))
    .send(params);
}

describe("consent before any text", () => {
  it("records a director's consent with the time and where it came from", async () => {
    const staff = await signUpHome();
    const anne = await contact(staff, { smsConsent: true });
    expect(anne.smsConsentAt).not.toBeNull();
    expect(anne.smsConsentSource).toBe("director");
  });

  it("does not text somebody who has not agreed, but still hands over the link", async () => {
    const staff = await signUpHome();
    const anne = await contact(staff);

    const res = await staff.agent.post(`/api/contacts/${anne.id}/send-link`).expect(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.smsError).toMatch(/agreed/);
    expect(res.body.link).toContain("/f/");
    expect(sent).toHaveLength(0);
  });

  it("texts once the director confirms consent, with opt-out wording", async () => {
    const staff = await signUpHome();
    const anne = await contact(staff);

    const res = await staff.agent
      .post(`/api/contacts/${anne.id}/send-link`)
      .send({ smsConsent: true })
      .expect(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.smsConsentSource).toBe("director");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.get("Body")).toContain("Reply STOP to opt out");
    expect(sent[0]!.body.get("From")).toBe("+13035550100");
  });
});

describe("the inbound webhook", () => {
  it("refuses a request Twilio did not sign", async () => {
    await inbound({ From: "+13035550142", Body: "STOP" }, "forged").expect(403);
  });

  it("honours STOP for good, and START undoes it", async () => {
    const staff = await signUpHome();
    const anne = await contact(staff, { smsConsent: true });

    const stop = await inbound({ From: "+13035550142", To: "+13035550100", Body: "Stop" }).expect(200);
    expect(stop.text).toContain("<Response>");

    const [row] = await db.select().from(familyContactsTable).where(eq(familyContactsTable.id, anne.id));
    expect(row!.smsOptedOutAt).not.toBeNull();
    expect(await db.select().from(smsOptOutsTable)).toHaveLength(1);

    const res = await staff.agent
      .post(`/api/contacts/${anne.id}/send-link`)
      .send({ smsConsent: true })
      .expect(200);
    expect(res.body.sent).toBe(false);
    expect(res.body.smsError).toMatch(/STOP/);
    expect(sent).toHaveLength(0);

    // Even typed again on a new case, the number stays off the list.
    await db.update(familyContactsTable).set({ smsOptedOutAt: null });
    const again = await staff.agent.post(`/api/contacts/${anne.id}/send-link`).expect(200);
    expect(again.body.sent).toBe(false);
    expect(sent).toHaveLength(0);

    await inbound({ From: "+13035550142", To: "+13035550100", Body: "START" }).expect(200);
    expect(await db.select().from(smsOptOutsTable)).toHaveLength(0);
    const ok = await staff.agent.post(`/api/contacts/${anne.id}/send-link`).expect(200);
    expect(ok.body.sent).toBe(true);
  });

  it("answers HELP with who is texting and how to stop", async () => {
    const staff = await signUpHome("Aspen Grove");
    await db
      .update(funeralHomesTable)
      .set({ smsTollFreeNumber: "+18885550100", smsTollFreeStatus: "verified", phone: "303-555-0000" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const res = await inbound({ From: "+13035550142", To: "+18885550100", Body: "help" }).expect(200);
    expect(res.text).toContain("Aspen Grove");
    expect(res.text).toContain("303-555-0000");
    expect(res.text).toContain("Reply STOP to opt out");
  });

  it("hears a stop in more words than the keyword, and says how to undo it", async () => {
    const staff = await signUpHome("Aspen Grove");
    const anne = await contact(staff, { smsConsent: true });

    const res = await inbound({ From: "+13035550142", To: "+13035550100", Body: "Stop please" }).expect(200);

    const [row] = await db.select().from(familyContactsTable).where(eq(familyContactsTable.id, anne.id));
    expect(row!.smsOptedOutAt).not.toBeNull();
    // Twilio does not confirm a phrase it does not know, so we do.
    expect(res.text).toContain("Aspen Grove: you won&#39;t get any more texts from us");
    expect(res.text).toContain("Reply START");
  });

  it("leaves Twilio's own answers to Twilio", async () => {
    const staff = await signUpHome("Aspen Grove");
    await db
      .update(funeralHomesTable)
      .set({ smsTollFreeNumber: "+18885550100", smsTollFreeStatus: "verified", phone: "303-555-0000" })
      .where(eq(funeralHomesTable.id, staff.homeId));

    const help = await inbound({
      From: "+13035550143",
      To: "+18885550100",
      Body: "HELP",
      OptOutType: "HELP",
    }).expect(200);
    expect(help.text).not.toContain("<Message>");
  });

  it("answers HELP on the shared number with the home they actually hear from", async () => {
    const staff = await signUpHome("Aspen Grove");
    await db.update(funeralHomesTable).set({ phone: "303-555-0000" }).where(eq(funeralHomesTable.id, staff.homeId));
    await contact(staff, { phone: "(303) 555-0144" });

    const res = await inbound({ From: "+13035550144", To: "+13035550100", Body: "help" }).expect(200);
    expect(res.text).toContain("Aspen Grove");
    expect(res.text).toContain("303-555-0000");
  });

  it("tells somebody writing to the number where a person is, once", async () => {
    const staff = await signUpHome("Aspen Grove");
    await db.update(funeralHomesTable).set({ phone: "303-555-0000" }).where(eq(funeralHomesTable.id, staff.homeId));
    const anne = await contact(staff, { phone: "(303) 555-0145", smsConsent: true });

    const message = "We will be there at the end of the service on Thursday, thank you";
    const first = await inbound({ From: "+13035550145", To: "+13035550100", Body: message }).expect(200);
    expect(first.text).toContain("this number can&#39;t take replies");
    expect(first.text).toContain("303-555-0000");

    // A sentence that happens to contain "end" is not a request to stop.
    const [row] = await db.select().from(familyContactsTable).where(eq(familyContactsTable.id, anne.id));
    expect(row!.smsOptedOutAt).toBeNull();

    const second = await inbound({ From: "+13035550145", To: "+13035550100", Body: "And the flowers?" }).expect(200);
    expect(second.text).not.toContain("<Message>");
  });

  it("checks a reply to a home's own number against that home's token", async () => {
    const staff = await signUpHome("Aspen Grove");
    const subaccount = "AC11111111111111111111111111111111";
    await db
      .update(funeralHomesTable)
      .set({ smsSubaccountSid: subaccount, smsMessagingServiceSid: "MG22222222222222222222222222222222" })
      .where(eq(funeralHomesTable.id, staff.homeId));
    const anne = await contact(staff, { phone: "(303) 555-0146", smsConsent: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith(`/Accounts/${subaccount}.json`)
          ? new Response(JSON.stringify({ auth_token: "subaccount-token" }), { status: 200 })
          : new Response("{}", { status: 404 }),
      ),
    );

    const params = {
      From: "+13035550146",
      To: "+17205550100",
      AccountSid: subaccount,
      MessagingServiceSid: "MG22222222222222222222222222222222",
      Body: "STOP",
    };
    await inbound(params, twilioSignature("subaccount-token", HOOK, params)).expect(200);
    const [row] = await db.select().from(familyContactsTable).where(eq(familyContactsTable.id, anne.id));
    expect(row!.smsOptedOutAt).not.toBeNull();

    // Naming the home's account is not enough without its signature.
    await inbound(params, twilioSignature("not-the-token", HOOK, params)).expect(403);
  });

  it("keeps a STOP to one home's number to that home", async () => {
    const aspen = await signUpHome("Aspen Grove");
    const mesa = await signUpHome("Mesa Verde");
    await db
      .update(funeralHomesTable)
      .set({ smsTollFreeNumber: "+18885550100", smsTollFreeStatus: "verified" })
      .where(eq(funeralHomesTable.id, aspen.homeId));
    const a = await contact(aspen, { smsConsent: true });
    const m = await contact(mesa, { smsConsent: true });

    await inbound({ From: "+13035550142", To: "+18885550100", Body: "STOP" }).expect(200);

    const rows = await db.select().from(familyContactsTable);
    expect(rows.find((r) => r.id === a.id)!.smsOptedOutAt).not.toBeNull();
    expect(rows.find((r) => r.id === m.id)!.smsOptedOutAt).toBeNull();
  });
});

describe("which number a home texts from", () => {
  const home = {
    id: 7,
    smsSubaccountSid: "AC11111111111111111111111111111111",
    smsMessagingServiceSid: "MG22222222222222222222222222222222",
    smsBrandStatus: "approved",
    smsCampaignStatus: "approved",
    smsTollFreeNumber: "+18885550100",
    smsTollFreeStatus: "verified",
  };

  it("prefers the home's approved 10DLC service, then toll-free, then the shared sender", () => {
    expect(smsRouteFor(home)).toMatchObject({
      kind: "10dlc",
      scope: "home:7",
      accountSid: home.smsSubaccountSid,
      messagingServiceSid: home.smsMessagingServiceSid,
    });
    expect(smsRouteFor({ ...home, smsCampaignStatus: "pending" })).toMatchObject({
      kind: "toll_free",
      from: "+18885550100",
    });
    expect(
      smsRouteFor({ ...home, smsCampaignStatus: "pending", smsTollFreeStatus: "pending" }),
    ).toMatchObject({ kind: "platform", scope: "platform", from: "+13035550100" });
  });

  it("reads the keywords carriers require", () => {
    expect(keywordOf(" stop ")).toBe("stop");
    expect(keywordOf("UNSUBSCRIBE")).toBe("stop");
    expect(keywordOf("Start")).toBe("start");
    expect(keywordOf("help")).toBe("help");
    expect(keywordOf("thank you so much")).toBeNull();
  });

  it("hears the FCC's revocation words in a short reply, and not in a sentence", () => {
    for (const reply of [
      "Stop please",
      "please stop texting me",
      "STOP!!",
      "Unsubscribe me",
      "opt out",
      "cancel",
      "Don't text me",
      "No more texts thanks",
      "End",
    ]) {
      expect(revokesConsent(reply), reply).toBe(true);
    }
    for (const reply of [
      "Thank you so much",
      "We will stop by the office at the end of the day tomorrow",
      "What time does it end on Thursday? Mom wanted to know",
      "",
    ]) {
      expect(revokesConsent(reply), reply).toBe(false);
    }
  });

  it("matches Twilio's documented signature", () => {
    const params = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+12349013030",
      Digits: "1234",
      From: "+12349013030",
      To: "+18005551212",
    };
    expect(twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", params)).toBe(
      "0/KCTR6DLpKmkAf8muzZqo1nDgQ=",
    );
  });

  it("lets a platform admin record a home's registration, and validates it", async () => {
    const ADMIN = "ops@continuumaftercare.example";
    await db.insert(platformAdminsTable).values({ email: ADMIN });
    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({ homeName: "Continuum", email: ADMIN, password: "correct-horse-battery" })
      .expect(201);
    await markEmailVerified(ADMIN);
    const staff = await signUpHome("Aspen Grove");

    await agent
      .put(`/api/admin/homes/${staff.homeId}/sms`)
      .send({ messagingServiceSid: "not-a-sid" })
      .expect(400);

    const res = await agent
      .put(`/api/admin/homes/${staff.homeId}/sms`)
      .send({
        subaccountSid: home.smsSubaccountSid,
        messagingServiceSid: home.smsMessagingServiceSid,
        brandStatus: "approved",
        campaignStatus: "approved",
      })
      .expect(200);
    expect(res.body.sendingFrom).toBe("10dlc");

    const anne = await contact(staff, { smsConsent: true });
    await staff.agent.post(`/api/contacts/${anne.id}/send-link`).expect(200);
    expect(sent[0]!.url).toContain(`/Accounts/${home.smsSubaccountSid}/Messages.json`);
    expect(sent[0]!.body.get("MessagingServiceSid")).toBe(home.smsMessagingServiceSid);
  });
});
