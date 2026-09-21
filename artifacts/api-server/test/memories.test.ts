import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The consent tests.
 *
 * A family writes two kinds of thing on the memories page: things they want
 * said out loud at a funeral, and things that are for the family. The tick
 * that separates them is the only thing standing between those two, and the
 * failure mode is not a bug report — it is a minister reading out a private
 * family argument from a pulpit.
 *
 * So the boundary is asserted from both directions: that an unticked memory
 * never reaches the officiant's brief whatever else is true, and that a
 * ticked one does.
 */
describe("memories", () => {
  it("keeps what the family wrote, with their name against it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    const created = await asFamily(family.token)
      .post("/api/family/memories")
      .send({
        prompt: "What did they always say?",
        body: "Put the kettle on and we will think about it.",
        forOfficiant: true,
      })
      .expect(201);

    expect(created.body.authorName).toBe("Anne Hale");
    expect(created.body.authorSide).toBe("family");
    expect(created.body.authorContactId).toBe(family.contactId);
    expect(created.body.prompt).toBe("What did they always say?");

    // The director sees the same row on the case.
    const seen = await staff.agent
      .get(`/api/cases/${row.id}/memories`)
      .expect(200);

    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].body).toContain("kettle");
  });

  it("never puts an unticked memory on the officiant's sheet", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceLocation: "St Mary's Chapel" });
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .post("/api/family/memories")
      .send({ body: "She fed every cat on the street.", forOfficiant: true })
      .expect(201);

    await asFamily(family.token)
      .post("/api/family/memories")
      .send({
        body: "The argument with Auntie Pat that nobody mentions.",
        forOfficiant: false,
      })
      .expect(201);

    const brief = await staff.agent
      .get(`/api/cases/${row.id}/officiant-brief`)
      .expect(200);

    expect(brief.text).toContain("every cat on the street");
    expect(brief.text).not.toContain("Auntie Pat");
  });

  it("lets the family change their mind in both directions", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    const created = await asFamily(family.token)
      .post("/api/family/memories")
      .send({ body: "Something they said at three in the morning.", forOfficiant: true })
      .expect(201);

    const withdrawn = await asFamily(family.token)
      .put(`/api/family/memories/${created.body.id}`)
      .send({ forOfficiant: false })
      .expect(200);

    expect(withdrawn.body.forOfficiant).toBe(false);

    const brief = await staff.agent
      .get(`/api/cases/${row.id}/officiant-brief`)
      .expect(200);

    expect(brief.text).not.toContain("three in the morning");
  });

  it("will not let one relative edit another's memory", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await inviteFamily(staff, row.id, { name: "Anne Hale" });
    const judith = await inviteFamily(staff, row.id, {
      name: "Judith Hale",
      role: "contributor",
    });

    const hers = await asFamily(anne.token)
      .post("/api/family/memories")
      .send({ body: "Mum taught us all to swim at Skegness." })
      .expect(201);

    // Judith can read it — they are on the same case and it is the same
    // family — but the words are Anne's.
    const visible = await asFamily(judith.token)
      .get("/api/family/memories")
      .expect(200);
    expect(visible.body).toHaveLength(1);

    await asFamily(judith.token)
      .put(`/api/family/memories/${hers.body.id}`)
      .send({ body: "Actually it was Cleethorpes." })
      .expect(404);

    await asFamily(judith.token)
      .delete(`/api/family/memories/${hers.body.id}`)
      .expect(404);

    const after = await asFamily(anne.token).get("/api/family/memories").expect(200);
    expect(after.body[0].body).toContain("Skegness");
  });

  it("records who gave the eulogy, not the director who typed it up", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    const tribute = await staff.agent
      .post(`/api/cases/${row.id}/memories`)
      .send({
        kind: "tribute",
        authorName: "Rev. James Okafor",
        body: "She was the one who put the kettle on.",
      })
      .expect(201);

    expect(tribute.body.kind).toBe("tribute");
    expect(tribute.body.authorName).toBe("Rev. James Okafor");
    // Not "home": the home kept the record, the minister said the words.
    expect(tribute.body.authorSide).toBe("other");

    // And the family can read it back, which is the whole point of keeping it.
    const theirs = await asFamily(family.token)
      .get("/api/family/memories")
      .expect(200);

    expect(theirs.body).toHaveLength(1);
    expect(theirs.body[0].body).toContain("kettle");
  });

  it("names the director when they write down what they were told", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const noted = await staff.agent
      .post(`/api/cases/${row.id}/memories`)
      .send({ body: "Her daughter rang to say she never missed the racing." })
      .expect(201);

    expect(noted.body.authorSide).toBe("home");
    expect(noted.body.authorName).toBe("Karen Voss");
  });

  it("carries the service, the family and the selections onto the sheet", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      serviceLocation: "St Mary's Chapel",
    });
    await inviteFamily(staff, row.id);

    await staff.agent
      .post(`/api/cases/${row.id}/selections`)
      .send({ kind: "hymn", value: "The Lord's My Shepherd", attribution: "Crimond" })
      .expect(201);

    const brief = await staff.agent
      .get(`/api/cases/${row.id}/officiant-brief`)
      .expect(200);

    expect(brief.headers["content-type"]).toContain("text/html");
    expect(brief.text).toContain("St Mary&#39;s Chapel");
    expect(brief.text).toContain("Anne Hale");
    expect(brief.text).toContain("Crimond");
    // Said plainly rather than left as an empty heading, because a minister
    // reading a blank section cannot tell it from one nobody filled in.
    expect(brief.text).toContain("has not marked anything");
  });

  it("escapes what a family typed instead of rendering it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .post("/api/family/memories")
      .send({
        body: "<script>alert('the vicar')</script>",
        forOfficiant: true,
      })
      .expect(201);

    const brief = await staff.agent
      .get(`/api/cases/${row.id}/officiant-brief`)
      .expect(200);

    expect(brief.text).not.toContain("<script>alert");
    expect(brief.text).toContain("&lt;script&gt;");
  });

  it("says plainly when email is not configured rather than claiming it sent", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const result = await staff.agent
      .post(`/api/cases/${row.id}/officiant-brief/email`)
      .send({ to: "minister@example.com" })
      .expect(200);

    // The test environment has no SMTP, which is exactly the case that must
    // not come back as `sent: true`.
    expect(result.body.sent).toBe(false);
    expect(result.body.to).toBe("minister@example.com");
    expect(result.body.reason).toMatch(/no email set up/i);
  });

  it("keeps one home's memories away from another", async () => {
    const one = await signUpHome("Willowbank");
    const two = await signUpHome("Fairhaven");

    const row = await createCase(one);
    const family = await inviteFamily(one, row.id);

    const created = await asFamily(family.token)
      .post("/api/family/memories")
      .send({ body: "Something private to this family." })
      .expect(201);

    await two.agent.get(`/api/cases/${row.id}/memories`).expect(404);
    await two.agent.get(`/api/cases/${row.id}/officiant-brief`).expect(404);
    await two.agent
      .put(`/api/memories/${created.body.id}`)
      .send({ forOfficiant: true })
      .expect(404);
    await two.agent.delete(`/api/memories/${created.body.id}`).expect(404);
  });

  it("goes into the archive, and out with an erased case", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .post("/api/family/memories")
      .send({ body: "She fed every cat on the street and denied it." })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/memories`)
      .send({
        kind: "tribute",
        authorName: "Rev. James Okafor",
        body: "She was the one who put the kettle on.",
      })
      .expect(201);

    /*
     * "What happens to our families' files if we stop paying you?" is one of
     * the two questions this export exists to answer, and what a family wrote
     * about their mother is the part of the archive that exists nowhere else.
     */
    const archive = await staff.agent
      .get(`/api/cases/${row.id}/export`)
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const zip = (archive.body as Buffer).toString("latin1");
    expect(zip).toContain("memories.txt");
    expect(zip).toContain("what-was-said.txt");
    expect(zip).toContain("fed every cat");
    expect(zip).toContain("put the kettle on");

    /*
     * And the other question. "Delete everything about my mother" has to mean
     * everything — the cascade is what makes that true, and a cascade is
     * exactly the kind of thing that is true until somebody adds a table.
     */
    await staff.agent
      .post(`/api/cases/${row.id}/delete`)
      .send({ confirmName: "Margaret Hale", reason: "The family asked." })
      .expect(204);

    await staff.agent.get(`/api/cases/${row.id}/memories`).expect(404);
    await asFamily(family.token).get("/api/family/memories").expect(401);
  });

  it("is not reachable at all without a link or a session", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await asFamily("not-a-real-token").get("/api/family/memories").expect(401);

    const { default: request } = await import("supertest");
    const { default: app } = await import("../src/app");
    await request(app).get(`/api/cases/${row.id}/memories`).expect(401);
    await request(app).get(`/api/cases/${row.id}/officiant-brief`).expect(401);
  });
});
