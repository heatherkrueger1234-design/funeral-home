import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * Things a family was waiting on that no director could see, and one thing
 * a director could not undo.
 *
 * Each of these was reachable from the API all along; what was missing was
 * the screen, or a definition that matched what a director means by the word.
 */

async function askForPrice(staff: Awaited<ReturnType<typeof signUpHome>>) {
  const row = await createCase(staff, { decedentLastName: "Hale" });
  const { token } = await inviteFamily(staff, row.id as number, {
    name: "Anne Hale",
  });

  const vendor = await staff.agent
    .post("/api/vendors")
    .send({
      kind: "monument",
      name: "Granite & Sons",
      postalCode: "80202",
      visibleToFamily: true,
    })
    .expect(201);

  const asked = await asFamily(token)
    .post("/api/family/quotes")
    .send({ vendorId: vendor.body.id, request: "A double headstone." })
    .expect(201);

  return { row, token, quoteId: asked.body.id as number };
}

describe("prices a family asked for", () => {
  it("reach the dashboard until somebody answers them", async () => {
    const staff = await signUpHome();
    const { row, token, quoteId } = await askForPrice(staff);

    const before = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(before.body.quoteRequestsWaiting).toBe(1);
    expect(before.body.quoteRequests).toHaveLength(1);
    expect(before.body.quoteRequests[0]).toMatchObject({
      id: quoteId,
      caseId: row.id,
      vendorName: "Granite & Sons",
    });
    expect(before.body.quoteRequests[0].decedentName).toContain("Hale");

    // The director sees it on the case, with who asked.
    const onCase = await staff.agent
      .get(`/api/cases/${row.id}/quotes`)
      .expect(200);
    expect(onCase.body[0].requestedByName).toBe("Anne Hale");

    // Ringing the vendor is not an answer; the family is still waiting.
    await staff.agent
      .put(`/api/quotes/${quoteId}`)
      .send({ status: "passed_on" })
      .expect(200);
    const passedOn = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(passedOn.body.quoteRequestsWaiting).toBe(1);

    // A reply without a figure is still an answer.
    await staff.agent
      .put(`/api/quotes/${quoteId}`)
      .send({ status: "quoted", response: "Depends on the stone — call us." })
      .expect(200);

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.quoteRequestsWaiting).toBe(0);
    expect(after.body.quoteRequests).toHaveLength(0);

    // And the family sees exactly what was written.
    const seen = await asFamily(token).get("/api/family/quotes").expect(200);
    expect(seen.body[0].response).toBe("Depends on the stone — call us.");
    expect(seen.body[0].quotedAmountCents).toBeNull();
  });

  it("are not counted for another home", async () => {
    const theirs = await signUpHome("Elm Street Chapel");
    await askForPrice(theirs);

    const mine = await signUpHome("Green Lawn");
    const res = await mine.agent.get("/api/home/dashboard").expect(200);
    expect(res.body.quoteRequestsWaiting).toBe(0);
  });

  it("stop being counted once the case is closed", async () => {
    const staff = await signUpHome();
    const { row } = await askForPrice(staff);

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(res.body.quoteRequestsWaiting).toBe(0);
  });
});

describe("an approved obituary", () => {
  async function approvedObituary() {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id as number);

    await staff.agent
      .put(`/api/cases/${row.id}/obituary`)
      .send({ draftText: "Margaret Hale died peacefully at home." })
      .expect(200);
    await staff.agent.post(`/api/cases/${row.id}/obituary/approve`).expect(200);

    return { staff, row, token };
  }

  it("can be reopened by the home, which lets the family edit again", async () => {
    const { staff, row, token } = await approvedObituary();

    // Approved: the family is locked out.
    await asFamily(token)
      .put("/api/family/obituary")
      .send({ biography: "She kept bees." })
      .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));

    const reopened = await staff.agent
      .post(`/api/cases/${row.id}/obituary/reopen`)
      .expect(200);

    expect(reopened.body.status).toBe("submitted");
    expect(reopened.body.approvedAt).toBeNull();
    expect(reopened.body.approvedByUserId).toBeNull();
    // The words are kept; only the sign-off is taken back.
    expect(reopened.body.draftText).toBe("Margaret Hale died peacefully at home.");

    await asFamily(token)
      .put("/api/family/obituary")
      .send({ biography: "She kept bees." })
      .expect(200);
  });

  it("cannot be reopened when it was never approved", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent.post(`/api/cases/${row.id}/obituary/reopen`).expect(409);
  });

  it("cannot be reopened from another home", async () => {
    const { row } = await approvedObituary();
    const other = await signUpHome("Elm Street Chapel");

    await other.agent.post(`/api/cases/${row.id}/obituary/reopen`).expect(404);
  });

  it("refuses to recompose over hand edits with a conflict", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .put(`/api/cases/${row.id}/obituary`)
      .send({ draftText: "Rewritten by hand." })
      .expect(200);

    // 409 is what the console keys "that would replace your edits" off.
    await staff.agent
      .post(`/api/cases/${row.id}/obituary/compose`)
      .send({})
      .expect(409);
  });
});

describe("waiting on a reply", () => {
  it("is not cleared by opening the thread, only by answering it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Can we bring our own music?" })
      .expect(201);

    // The director glances at it between services.
    await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);

    const dashboard = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(dashboard.body.casesWaitingOnReply).toBe(1);
    expect(dashboard.body.unansweredMessages).toBe(1);

    const inbox = await staff.agent.get("/api/home/inbox").expect(200);
    // Read, so nothing is "new" — but still waiting.
    expect(inbox.body[0].unreadFromFamily).toBe(0);
    expect(inbox.body[0].waitingOnReply).toBe(true);

    await staff.agent
      .post(`/api/cases/${row.id}/messages`)
      .send({ body: "Of course." })
      .expect(201);

    const answered = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(answered.body.casesWaitingOnReply).toBe(0);
    expect(answered.body.unansweredMessages).toBe(0);

    const after = await staff.agent.get("/api/home/inbox").expect(200);
    expect(after.body[0].waitingOnReply).toBe(false);
  });

  it("counts only the messages since the home last wrote", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "First question" })
      .expect(201);
    await staff.agent
      .post(`/api/cases/${row.id}/messages`)
      .send({ body: "Answered" })
      .expect(201);
    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Follow-up one" })
      .expect(201);
    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Follow-up two" })
      .expect(201);

    const res = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(res.body.casesWaitingOnReply).toBe(1);
    expect(res.body.unansweredMessages).toBe(2);
  });

  it("sorts a read-but-unanswered family above an answered one", async () => {
    const staff = await signUpHome();

    const waiting = await createCase(staff, { decedentLastName: "Waiting" });
    const waitingFamily = await inviteFamily(staff, waiting.id as number);
    await asFamily(waitingFamily.token)
      .post("/api/family/messages")
      .send({ body: "Still waiting" })
      .expect(201);
    await staff.agent.get(`/api/cases/${waiting.id}/messages`).expect(200);

    // Answered more recently, so recency alone would put it first.
    const answered = await createCase(staff, { decedentLastName: "Answered" });
    await staff.agent
      .post(`/api/cases/${answered.id}/messages`)
      .send({ body: "Just checking in" })
      .expect(201);

    const res = await staff.agent.get("/api/home/inbox").expect(200);
    expect(res.body[0].decedentName).toContain("Waiting");
    expect(res.body[0].waitingOnReply).toBe(true);
    expect(res.body[1].waitingOnReply).toBe(false);
  });

  it("has already marked the thread read by the time it answers", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id as number);

    await asFamily(family.token)
      .post("/api/family/messages")
      .send({ body: "Hello" })
      .expect(201);

    await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);

    // No wait, no retry: the very next read must already agree.
    const inbox = await staff.agent.get("/api/home/inbox").expect(200);
    expect(inbox.body[0].unreadFromFamily).toBe(0);
  });
});
