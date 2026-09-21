import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { db, platformAdminsTable } from "@workspace/db";
import { hashPassword } from "../src/lib/auth";
import { engagementForHomes } from "../src/lib/engagement";
import { signUpHome, createCase, inviteFamily, asFamily } from "./helpers";

/**
 * Engagement, Colorado's clock, offered times, consent, and the page a
 * family still opens in March.
 *
 * Against a real Postgres, like everything else here. What is worth catching
 * in this component is not a rendering bug: it is a text going to somebody
 * who said stop, two families given the same eleven o'clock, or a widow
 * shown the home's own paperwork on her mother's timeline.
 */

const SATURDAY = "2026-07-11T16:00:00.000Z";

/* ------------------------------------------------------ Colorado's clock -- */

describe("Colorado's deadlines", () => {
  it("apply themselves to a new case with a service date, with no button pressed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    const keys = res.body.deadlines.map((d: { key: string }) => d.key);
    expect(keys).toContain("death-certificate-filed");
    expect(keys).toContain("medical-certification");
    expect(keys).toContain("embalming-or-refrigeration");
    expect(keys).toContain("disposition-permit");
    expect(keys).toContain("cremation-authorization");
  });

  it("apply to a case that has no service date at all", async () => {
    // The 72 hours run from taking custody, not from a funeral nobody has
    // booked yet. This is exactly the case whose clock is already running.
    const staff = await signUpHome();
    const row = await createCase(staff);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    const certificate = res.body.deadlines.find(
      (d: { key: string }) => d.key === "death-certificate-filed",
    );

    expect(certificate.dueAt).not.toBeNull();
    expect(res.body.clock.custodyAssumed).toBe(true);
  });

  it("puts the certificate 72 hours after custody, and moves it when custody is corrected", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });

    const custody = "2026-07-08T15:00:00.000Z";

    const res = await staff.agent
      .put(`/api/cases/${row.id}/statutory/clock`)
      .send({ custodyTakenAt: custody })
      .expect(200);

    expect(res.body.clock.custodyAssumed).toBe(false);
    expect(res.body.clock.confirmedAt).not.toBeNull();

    const certificate = res.body.deadlines.find(
      (d: { key: string }) => d.key === "death-certificate-filed",
    );

    expect(Date.parse(certificate.dueAt) - Date.parse(custody)).toBe(
      72 * 60 * 60 * 1000,
    );
  });

  it("waits for the EDRS request rather than inventing a date for it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });

    const before = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    const medical = before.body.deadlines.find(
      (d: { key: string }) => d.key === "medical-certification",
    );
    expect(medical.dueAt).toBeNull();
    expect(medical.standing).toBe("no_date_yet");

    const requested = "2026-07-09T17:00:00.000Z";
    const after = await staff.agent
      .put(`/api/cases/${row.id}/statutory/clock`)
      .send({ edrsRequestedAt: requested })
      .expect(200);

    const updated = after.body.deadlines.find(
      (d: { key: string }) => d.key === "medical-certification",
    );
    expect(Date.parse(updated.dueAt) - Date.parse(requested)).toBe(
      72 * 60 * 60 * 1000,
    );
  });

  it("says 'before disposition' in words rather than inventing a clock", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    const permit = res.body.deadlines.find(
      (d: { key: string }) => d.key === "disposition-permit",
    );

    expect(permit.dueAt).toBeNull();
    expect(permit.standing).toBe("before_disposition");
    expect(permit.standingLabel).toBe("Needed before disposition");
  });

  it("stands the cremation authorization down once the case is recorded as a burial", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });

    await staff.agent.get(`/api/cases/${row.id}/statutory`).expect(200);

    await staff.agent
      .put(`/api/cases/${row.id}/vitals`)
      .send({ dispositionType: "Burial" })
      .expect(200);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    const cremation = res.body.deadlines.find(
      (d: { key: string }) => d.key === "cremation-authorization",
    );

    expect(cremation.standing).toBe("not_applicable");
    // Kept rather than deleted, so the record still shows it was considered.
    expect(cremation.notApplicableReason).toContain("burial");
  });

  it("never puts the home's own paperwork on the family's timeline", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    await staff.agent.get(`/api/cases/${row.id}/statutory`).expect(200);

    const timeline = await asFamily(token)
      .get("/api/family/deadlines")
      .expect(200);

    const titles = timeline.body.map((entry: { title: string }) => entry.title);
    expect(titles.join(" ")).not.toContain("certificate of death");
    expect(titles.join(" ")).not.toContain("Medical certification");

    // And it does not inflate what she is told is left to do.
    const session = await asFamily(token)
      .get("/api/family/session")
      .expect(200);
    expect(session.body.outstandingDeadlines).toBe(4);
  });

  it("does not run any of it against somebody arranging their own funeral", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { kind: "pre_need" });

    const res = await staff.agent
      .get(`/api/cases/${row.id}/statutory`)
      .expect(200);

    expect(res.body.deadlines).toHaveLength(0);
  });

  it("keeps one home's schedule out of another's", async () => {
    const one = await signUpHome("Horan & McConaty");
    const two = await signUpHome("Olinger");
    const row = await createCase(one, { serviceAt: SATURDAY });

    await two.agent.get(`/api/cases/${row.id}/statutory`).expect(404);
  });
});

/* ------------------------------------------------------- offered times -- */

describe("times the home offers and the family picks", () => {
  const twoSlots = {
    slots: [
      {
        kind: "viewing",
        label: "Private viewing, immediate family",
        startsAt: "2099-07-09T17:00:00.000Z",
        durationMinutes: 45,
        location: "The east chapel",
      },
      {
        kind: "viewing",
        label: "Private viewing, immediate family",
        startsAt: "2099-07-09T19:00:00.000Z",
      },
    ],
  };

  it("lets a family take one of the offered times and nothing else", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const offered = await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send(twoSlots)
      .expect(201);

    const onOffer = await asFamily(token).get("/api/family/slots").expect(200);
    expect(onOffer.body).toHaveLength(2);
    expect(
      onOffer.body.every((slot: { isMine: boolean }) => !slot.isMine),
    ).toBe(true);

    const taken = await asFamily(token)
      .post(`/api/family/slots/${offered.body[0].id}/take`)
      .send({})
      .expect(200);

    expect(taken.body.isMine).toBe(true);
    expect(taken.body.takenAt).not.toBeNull();
    expect(taken.body.location).toBe("The east chapel");
  });

  it("gives one eleven o'clock to one family, not two", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token: anne } = await inviteFamily(staff, row.id as number);
    const { token: james } = await inviteFamily(staff, row.id as number, {
      name: "James Hale",
    });

    const offered = await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send({ slots: [twoSlots.slots[0]] })
      .expect(201);

    const slotId = offered.body[0].id;

    await asFamily(anne)
      .post(`/api/family/slots/${slotId}/take`)
      .send({})
      .expect(200);

    const second = await asFamily(james)
      .post(`/api/family/slots/${slotId}/take`)
      .send({})
      .expect(409);

    expect(second.body.error).toContain("took that one");
  });

  it("puts a released time back on offer", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const offered = await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send({ slots: [twoSlots.slots[0]] })
      .expect(201);

    const slotId = offered.body[0].id;

    await asFamily(token)
      .post(`/api/family/slots/${slotId}/take`)
      .send({})
      .expect(200);
    const released = await asFamily(token)
      .post(`/api/family/slots/${slotId}/release`)
      .send({})
      .expect(200);

    expect(released.body.isMine).toBe(false);
    expect(released.body.takenAt).toBeNull();
  });

  it("keeps a withdrawn time rather than letting it vanish", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const offered = await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send({ slots: [twoSlots.slots[0]] })
      .expect(201);

    const slotId = offered.body[0].id;
    await asFamily(token)
      .post(`/api/family/slots/${slotId}/take`)
      .send({})
      .expect(200);

    const withdrawn = await staff.agent
      .delete(`/api/slots/${slotId}`)
      .expect(200);
    expect(withdrawn.body.withdrawnAt).not.toBeNull();

    // The family who had it is still shown it, so they can be told.
    const mine = await asFamily(token).get("/api/family/slots").expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].withdrawnAt).not.toBeNull();
  });

  it("does not offer one home's times to another home's family", async () => {
    const one = await signUpHome("Horan & McConaty");
    const two = await signUpHome("Olinger");

    const theirs = await createCase(one, { serviceAt: SATURDAY });
    await one.agent
      .post(`/api/cases/${theirs.id}/slots`)
      .send({ slots: [twoSlots.slots[0]] })
      .expect(201);

    const ours = await createCase(two, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(two, ours.id as number);

    expect(
      (await asFamily(token).get("/api/family/slots").expect(200)).body,
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- consent -- */

describe("nothing sends without recorded consent", () => {
  it("refuses to text a number nobody has agreed for, and says who to ring", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { contactId } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send({
        slots: [
          { label: "Come and see us", startsAt: "2099-07-09T17:00:00.000Z" },
        ],
      })
      .expect(201);

    const res = await staff.agent
      .post(`/api/cases/${row.id}/slots/notice`)
      .send({ contactIds: [contactId] })
      .expect(200);

    expect(res.body.sent).toHaveLength(0);
    expect(res.body.notSent).toHaveLength(1);
    expect(res.body.notSent[0].name).toBe("Anne Hale");
    expect(res.body.notSent[0].reason).toContain("no record");
  });

  it("stops refusing for that reason once the consent is recorded", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { contactId } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/slots`)
      .send({
        slots: [
          { label: "Come and see us", startsAt: "2099-07-09T17:00:00.000Z" },
        ],
      })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId, sourceDetail: "Said yes on the telephone" })
      .expect(201);

    const res = await staff.agent
      .post(`/api/cases/${row.id}/slots/notice`)
      .send({ contactIds: [contactId] })
      .expect(200);

    /*
     * There is no Twilio account on a test run, so the send still does not
     * happen — but it is now the carrier stopping it and not us, which is
     * exactly what this test exists to tell apart.
     */
    expect(res.body.notSent[0].reason).not.toContain("no record");
    expect(res.body.notSent[0].reason).toContain("not set up");
  });

  it("records who took the consent, when, and what was said", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { contactId } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId, sourceDetail: "Said yes on the telephone" })
      .expect(201);

    const held = await staff.agent
      .get(`/api/cases/${row.id}/messaging-consent`)
      .expect(200);

    const sms = held.body.find(
      (entry: { channel: string }) => entry.channel === "sms",
    );

    expect(sms.granted).toBe(true);
    expect(sms.grantedAt).not.toBeNull();
    expect(sms.source).toBe("director_recorded");
    expect(sms.sourceDetail).toBe("Said yes on the telephone");
    expect(sms.address).toBe("+13035550142");
  });

  it("treats a family's no as final, and will not let a director undo it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { contactId, token } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId })
      .expect(201);

    await asFamily(token)
      .post("/api/family/messaging-consent")
      .send({ consent: false })
      .expect(200);

    const refused = await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId })
      .expect(409);

    expect(refused.body.error).toContain("stop");

    const notice = await staff.agent
      .post(`/api/cases/${row.id}/slots/notice`)
      .send({ contactIds: [contactId] })
      .expect(400);

    // No open times on this case, so the refusal comes earlier — the point
    // is only that nothing sent.
    expect(notice.body.error).toBeDefined();
  });
});

/* -------------------------------------------------------------- STOP -- */

describe("STOP, arriving from a carrier", () => {
  const AUTH_TOKEN = "a-twilio-auth-token";
  let previous: string | undefined;

  beforeAll(() => {
    previous = process.env["TWILIO_AUTH_TOKEN"];
    process.env["TWILIO_AUTH_TOKEN"] = AUTH_TOKEN;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env["TWILIO_AUTH_TOKEN"];
    else process.env["TWILIO_AUTH_TOKEN"] = previous;
  });

  /** Twilio's own scheme: the URL, then every parameter in key order. */
  function sign(url: string, params: Record<string, string>): string {
    const payload = Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], url);
    return createHmac("sha1", AUTH_TOKEN).update(payload).digest("base64");
  }

  function inbound(params: Record<string, string>, signature?: string) {
    const url = "http://127.0.0.1/api/sms/inbound";
    return request(app)
      .post("/api/sms/inbound")
      .set("Host", "127.0.0.1")
      .set("X-Twilio-Signature", signature ?? sign(url, params))
      .type("form")
      .send(params);
  }

  it("refuses an unsigned request", async () => {
    await inbound(
      { From: "+13035550142", Body: "STOP" },
      "not-a-signature",
    ).expect(403);
  });

  it("stops everything, permanently, including the check-ins", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: "2020-07-11T16:00:00.000Z",
    });
    const { contactId } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
      email: "anne@example.com",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId })
      .expect(201);

    // Closing the case is what enrols the family in the grief check-ins.
    await staff.agent.post(`/api/cases/${row.id}/close`).send({}).expect(200);

    await inbound({ From: "+13035550142", Body: "STOP" }).expect(200);

    const held = await staff.agent
      .get(`/api/cases/${row.id}/messaging-consent`)
      .expect(200);

    const sms = held.body.find(
      (entry: { channel: string }) => entry.channel === "sms",
    );
    expect(sms.granted).toBe(false);
    expect(sms.revokedReason).toBe("STOP");

    const aftercare = await staff.agent
      .get(`/api/cases/${row.id}/aftercare`)
      .expect(200);
    expect(aftercare.body[0].unsubscribedAt).not.toBeNull();

    // And it stays stopped: a director cannot re-grant it.
    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId })
      .expect(409);
  });

  it("ignores a message that is not a stop keyword", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { contactId } = await inviteFamily(staff, row.id as number, {
      phone: "303-555-0142",
    });

    await staff.agent
      .post(`/api/cases/${row.id}/messaging-consent`)
      .send({ contactId })
      .expect(201);

    await inbound({
      From: "+13035550142",
      Body: "I cannot stop thinking about the service, thank you",
    }).expect(200);

    const held = await staff.agent
      .get(`/api/cases/${row.id}/messaging-consent`)
      .expect(200);

    expect(
      held.body.find((entry: { channel: string }) => entry.channel === "sms")
        .granted,
    ).toBe(true);
  });
});

/* ----------------------------------------------------------- engagement -- */

describe("what the director can see", () => {
  it("says whether the link was opened, and by whom", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);
    await inviteFamily(staff, row.id as number, { name: "James Hale" });

    const before = await staff.agent
      .get(`/api/cases/${row.id}/engagement`)
      .expect(200);

    expect(before.body.linksCreated).toBe(2);
    expect(before.body.linksOpened).toBe(0);
    expect(
      before.body.attention.map((entry: { key: string }) => entry.key),
    ).toContain("link-not-opened");

    await asFamily(token).get("/api/family/session").expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/engagement`)
      .expect(200);

    expect(after.body.linksOpened).toBe(1);
    const anne = after.body.contacts.find(
      (entry: { name: string }) => entry.name === "Anne Hale",
    );
    expect(anne.linkOpened).toBe(true);
    expect(anne.firstSeenAt).not.toBeNull();
  });

  it("names the family worth ringing, and leaves the rest alone", async () => {
    const staff = await signUpHome();
    const stuck = await createCase(staff, { serviceAt: SATURDAY });
    await inviteFamily(staff, stuck.id as number);

    const res = await staff.agent.get("/api/engagement").expect(200);

    const entry = res.body.cases.find(
      (item: { caseId: number }) => item.caseId === stuck.id,
    );

    expect(entry.displayName).toBe("Margaret Hale");
    expect(entry.attention.length).toBeGreaterThan(0);
    // Sentences, not scores. Nothing here ranks one family against another.
    for (const note of entry.attention) {
      expect(typeof note.sentence).toBe("string");
      expect(note.sentence.length).toBeGreaterThan(10);
    }
  });

  it("aggregates a home in the shape the admin console renders", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);
    await asFamily(token).get("/api/family/session").expect(200);

    const res = await staff.agent.get("/api/engagement").expect(200);

    expect(res.body.home).toMatchObject({
      casesOpened: 1,
      casesActive: 1,
      familyLinksCreated: 1,
      familyLinksOpened: 1,
      photographs: 0,
      aftercareEnrolled: 0,
      aftercareConsented: 0,
      aftercareDeclined: 0,
      aftercareUnsubscribed: 0,
    });
    expect(res.body.home.familiesContributing).toBe(1);
  });

  it("counts only its own home", async () => {
    const one = await signUpHome("Horan & McConaty");
    const two = await signUpHome("Olinger");

    await createCase(one, { serviceAt: SATURDAY });
    await createCase(one, { serviceAt: SATURDAY });
    await createCase(two, { serviceAt: SATURDAY });

    const res = await two.agent.get("/api/engagement").expect(200);
    expect(res.body.home.casesOpened).toBe(1);
  });
});

/* ------------------------------------------------------------ keepsake -- */

describe("what the family is left with", () => {
  it("stays out of the way while the funeral is still ahead", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: "2099-07-11T16:00:00.000Z",
    });
    const { token } = await inviteFamily(staff, row.id as number);

    const res = await asFamily(token).get("/api/family/keepsake").expect(200);
    expect(res.body.phase).toBe("arranging");
  });

  it("switches to holding once the service has happened", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: "2020-07-11T16:00:00.000Z",
    });
    const { token } = await inviteFamily(staff, row.id as number);

    const res = await asFamily(token).get("/api/family/keepsake").expect(200);
    expect(res.body.phase).toBe("keeping");
    expect(res.body.displayName).toBe("Margaret Hale");
  });

  it("hands back the obituary only once it has been approved", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: "2020-07-11T16:00:00.000Z",
    });
    const { token } = await inviteFamily(staff, row.id as number);

    await staff.agent
      .put(`/api/cases/${row.id}/obituary`)
      .send({ draftText: "Margaret Hale, of Aurora, died on Tuesday." })
      .expect(200);

    expect(
      (await asFamily(token).get("/api/family/keepsake").expect(200)).body
        .obituary,
    ).toBeNull();

    await staff.agent
      .post(`/api/cases/${row.id}/obituary/approve`)
      .send({})
      .expect(200);

    const res = await asFamily(token).get("/api/family/keepsake").expect(200);
    expect(res.body.obituary).toContain("Margaret Hale, of Aurora");
  });

  it("includes the check-ins still to come once the case is closed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: "2020-07-11T16:00:00.000Z",
    });
    const { token } = await inviteFamily(staff, row.id as number, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).send({}).expect(200);

    const res = await asFamily(token).get("/api/family/keepsake").expect(200);

    expect(res.body.checkInsStatus).toBe("pending");
    expect(
      res.body.checkIns.map((entry: { dayOffset: number }) => entry.dayOffset),
    ).toEqual([30, 60, 90, 365]);
  });
});

/* ------------------------------------------------- the two must not drift -- */

/**
 * The admin console counts the same things, and has to get the same answers.
 *
 * Component 2 landed with its own `platformEngagementFor` inside `admin.ts`,
 * written before this component existed. That file belongs to Component 2 and
 * is not ours to rewrite — but two implementations of the same counting is
 * exactly how a home ends up with an overview screen and a case list that
 * disagree about how many links were opened, with nobody able to say which is
 * lying.
 *
 * So this asserts they agree, field for field, on everything they both claim
 * to count. Whoever changes either one next finds out here rather than from a
 * customer, and the fix is to delete the duplicate and import
 * `engagementForHomes` — which is the whole reason its field names were kept
 * identical to what that console already renders.
 */
describe("the admin console's counting and ours", () => {
  it("agree on every field they both report", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: SATURDAY });
    const { token } = await inviteFamily(staff, row.id as number);
    await inviteFamily(staff, row.id as number, { name: "James Hale" });
    await asFamily(token).get("/api/family/session").expect(200);

    const agent = request.agent(app);
    await db.insert(platformAdminsTable).values({
      email: "heather@holdingtoday.example",
      passwordHash: await hashPassword("correct-horse-battery"),
      displayName: "Heather Krueger",
      role: "owner",
    });
    await agent
      .post("/api/admin/auth/login")
      .send({
        email: "heather@holdingtoday.example",
        password: "correct-horse-battery",
      })
      .expect(200);

    const theirs = (
      await agent.get(`/api/admin/homes/${staff.homeId}`).expect(200)
    ).body.engagement;

    const ours = (await engagementForHomes([staff.homeId])).get(staff.homeId)!;

    // Named explicitly, so that an `engagement` block that quietly became
    // empty passes this loop vacuously rather than catching anything.
    expect(Object.keys(theirs).sort()).toEqual(
      [
        "aftercareConsented",
        "aftercareDeclined",
        "aftercareEnrolled",
        "aftercareUnsubscribed",
        "casesActive",
        "casesOpened",
        "familyLinksCreated",
        "familyLinksOpened",
        "photographs",
      ].sort(),
    );

    for (const field of Object.keys(theirs) as (keyof typeof ours)[]) {
      expect(
        { field, value: ours[field] },
        `${field} disagrees between admin.ts and lib/engagement.ts`,
      ).toEqual({ field, value: theirs[field] });
    }
  });
});
