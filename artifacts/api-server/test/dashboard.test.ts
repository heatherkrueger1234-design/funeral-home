import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The master page, and the cross-case inbox behind it.
 *
 * Both are read-only views over data that is already asserted elsewhere, so
 * what is worth testing here is what they *would not* show: another home's
 * work, a closed case's overdue steps, and the service itself sitting in a
 * list headed "overdue".
 */

const daysFromNow = (days: number) => {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + days);
  when.setUTCHours(11, 0, 0, 0);
  return when;
};

describe("the dashboard", () => {
  it("counts only this home's work", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street Chapel");

    await createCase(mine, { decedentLastName: "Mine" });
    await createCase(theirs, { decedentLastName: "Theirs" });
    await createCase(theirs, { decedentLastName: "AlsoTheirs" });

    const res = await mine.agent.get("/api/home/dashboard").expect(200);

    expect(res.body.openCases).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("Theirs");
  });

  it("names the cases with no service date, because those are the silent ones", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { decedentLastName: "Hale" });
    await inviteFamily(staff, row.id as number);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);

    expect(res.body.awaitingServiceDate).toHaveLength(1);
    expect(res.body.awaitingServiceDate[0].decedentName).toContain("Hale");

    // Once it has a date it is no longer waiting, it is next week's work.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(3).toISOString() })
      .expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.awaitingServiceDate).toHaveLength(0);
    expect(after.body.servicesThisWeek).toHaveLength(1);
  });

  it("never puts the funeral itself in a list headed overdue", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(-3).toISOString() })
      .expect(200);

    await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(200);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);

    expect(res.body.overdue.length).toBeGreaterThan(0);
    expect(
      res.body.overdue.every((row: { isEvent: boolean }) => !row.isEvent),
    ).toBe(true);
  });

  it("stops counting a case once it is closed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: daysFromNow(-3).toISOString() })
      .expect(200);
    await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(200);

    const before = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(before.body.overdue.length).toBeGreaterThan(0);

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.overdue).toHaveLength(0);
    expect(after.body.openCases).toBe(0);
  });

  it("counts families waiting, not just messages waiting", async () => {
    const staff = await signUpHome();

    for (const name of ["Hale", "Okonkwo"]) {
      const row = await createCase(staff, { decedentLastName: name });
      const family = await inviteFamily(staff, row.id as number);
      await asFamily(family.token)
        .post("/api/family/messages")
        .send({ body: `Two messages from the ${name}s, one` })
        .expect(201);
      await asFamily(family.token)
        .post("/api/family/messages")
        .send({ body: `Two messages from the ${name}s, two` })
        .expect(201);
    }

    const res = await staff.agent.get("/api/home/dashboard").expect(200);

    expect(res.body.unansweredMessages).toBe(4);
    expect(res.body.casesWaitingOnReply).toBe(2);
  });
});

describe("the inbox", () => {
  it("puts the family who is waiting above the one who was answered", async () => {
    const staff = await signUpHome();

    const answered = await createCase(staff, { decedentLastName: "Answered" });
    const answeredFamily = await inviteFamily(staff, answered.id as number);
    await asFamily(answeredFamily.token)
      .post("/api/family/messages")
      .send({ body: "Asked something" })
      .expect(201);
    // Opening the thread is what marks it read.
    await staff.agent.get(`/api/cases/${answered.id}/messages`).expect(200);
    await staff.agent
      .post(`/api/cases/${answered.id}/messages`)
      .send({ body: "Answered it" })
      .expect(201);

    const waiting = await createCase(staff, { decedentLastName: "Waiting" });
    const waitingFamily = await inviteFamily(staff, waiting.id as number);
    await asFamily(waitingFamily.token)
      .post("/api/family/messages")
      .send({ body: "Still waiting" })
      .expect(201);

    const res = await staff.agent.get("/api/home/inbox").expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].decedentName).toContain("Waiting");
    expect(res.body[0].unreadFromFamily).toBe(1);
    expect(res.body[1].unreadFromFamily).toBe(0);
    expect(res.body[1].lastMessageFrom).toBe("home");
  });

  it("counts a family as answered once the home replies, even from the inbox", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { decedentLastName: "Replied" });
    const family = await inviteFamily(staff, row.id as number);
    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Is Friday still right?" })
      .expect(201);

    // Straight from the inbox's reply box: the thread itself is never opened.
    await staff.agent
      .post(`/api/cases/${row.id}/messages`)
      .send({ body: "Yes, eleven o'clock." })
      .expect(201);

    const inbox = await staff.agent.get("/api/home/inbox").expect(200);
    expect(inbox.body[0].unreadFromFamily).toBe(0);

    const dashboard = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(dashboard.body.casesWaitingOnReply).toBe(0);
  });

  it("lists nothing for a case nobody has written on", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await inviteFamily(staff, row.id as number);

    const res = await staff.agent.get("/api/home/inbox").expect(200);
    expect(res.body).toHaveLength(0);
  });

  it("does not show one home another home's conversations", async () => {
    const theirs = await signUpHome("Elm Street Chapel");
    const theirCase = await createCase(theirs, { decedentLastName: "Theirs" });
    const theirFamily = await inviteFamily(theirs, theirCase.id as number);
    await asFamily(theirFamily.token)
      .post("/api/family/messages")
      .send({ body: "Private to them" })
      .expect(201);

    const mine = await signUpHome("Green Lawn");
    const res = await mine.agent.get("/api/home/inbox").expect(200);

    expect(res.body).toHaveLength(0);
  });

  it("trims a long message to a glance", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    const long = `${"We have been talking about the photographs ".repeat(20)}end`;
    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: long })
      .expect(201);

    const res = await staff.agent.get("/api/home/inbox").expect(200);

    expect(res.body[0].lastMessageBody.length).toBeLessThan(160);
    expect(res.body[0].lastMessageBody.endsWith("…")).toBe(true);
  });
});
