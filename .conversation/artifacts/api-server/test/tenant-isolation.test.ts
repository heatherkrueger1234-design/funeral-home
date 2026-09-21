import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * The tests that would matter most if they ever failed.
 *
 * One funeral home must never reach another's families, and a link token must
 * never reach a case other than its own. Both are enforced by query scoping
 * rather than by anything visible in a route's shape, which is exactly the
 * kind of guarantee that rots silently — so it is asserted here directly.
 */

describe("one home cannot reach another home's data", () => {
  it("returns 404 for another home's case, rather than the case", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street Chapel");

    const theirCase = await createCase(theirs, { decedentLastName: "Okonkwo" });

    // The id is real and the request is authenticated — it is only the
    // tenant filter standing between this and someone else's family.
    await mine.agent.get(`/api/cases/${theirCase.id}`).expect(404);
    await mine.agent.put(`/api/cases/${theirCase.id}`).send({ serviceLocation: "x" }).expect(404);
    await mine.agent.post(`/api/cases/${theirCase.id}/close`).expect(404);
    await mine.agent.get(`/api/cases/${theirCase.id}/photos`).expect(404);
    await mine.agent.get(`/api/cases/${theirCase.id}/messages`).expect(404);
    await mine.agent.get(`/api/cases/${theirCase.id}/obituary`).expect(404);
    await mine.agent.get(`/api/cases/${theirCase.id}/deadlines`).expect(404);
    await mine.agent.get(`/api/cases/${theirCase.id}/contacts`).expect(404);
  });

  it("does not list another home's cases", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street Chapel");

    await createCase(mine, { decedentLastName: "Mine" });
    await createCase(theirs, { decedentLastName: "Theirs" });

    const res = await mine.agent.get("/api/cases").expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].decedentLastName).toBe("Mine");
  });

  it("will not revoke another home's family link", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street Chapel");

    const theirCase = await createCase(theirs);
    const { contactId, token } = await inviteFamily(theirs, theirCase.id);

    await mine.agent.delete(`/api/contacts/${contactId}`).expect(404);
    await mine.agent.post(`/api/contacts/${contactId}/link`).expect(404);

    // Still works, because nothing was revoked.
    await asFamily(token).get("/api/family/session").expect(200);
  });
});

describe("a family link reaches exactly one case", () => {
  it("is refused entirely without a token", async () => {
    await request(app).get("/api/family/session").expect(401);
    await request(app).get("/api/family/photos").expect(401);
    await request(app).get("/api/family/messages").expect(401);
  });

  it("is refused once revoked, expired or unknown", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId, token } = await inviteFamily(staff, row.id);

    await asFamily(token).get("/api/family/session").expect(200);

    await staff.agent.delete(`/api/contacts/${contactId}`).expect(204);

    await asFamily(token).get("/api/family/session").expect(401);
    await asFamily("not-a-real-token").get("/api/family/session").expect(401);
  });

  it("reissuing a link kills the previous one", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId, token } = await inviteFamily(staff, row.id);

    const res = await staff.agent
      .post(`/api/contacts/${contactId}/link`)
      .expect(200);
    const fresh = String(res.body.link).split("/f/")[1]!;

    expect(fresh).not.toBe(token);
    await asFamily(fresh).get("/api/family/session").expect(200);
    await asFamily(token).get("/api/family/session").expect(401);
  });

  it("cannot fetch an upload belonging to another case", async () => {
    const staff = await signUpHome();

    const caseA = await createCase(staff, { decedentLastName: "Alpha" });
    const caseB = await createCase(staff, { decedentLastName: "Beta" });

    const familyA = await inviteFamily(staff, caseA.id);
    const familyB = await inviteFamily(staff, caseB.id, { name: "Bob Beta" });

    const upload = await asFamily(familyA.token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "gran.png")
      .expect(201);

    const uploadId = upload.body.uploadId;

    // The owner can read it back...
    await asFamily(familyA.token).get(`/api/family/uploads/${uploadId}`).expect(200);
    // ...and the other family, at the same home, cannot.
    await asFamily(familyB.token).get(`/api/family/uploads/${uploadId}`).expect(404);
  });

  it("will not let one family member delete another's photograph", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const anne = await inviteFamily(staff, row.id, { name: "Anne" });
    const bob = await inviteFamily(staff, row.id, { name: "Bob" });

    const photo = await asFamily(anne.token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "gran.png")
      .expect(201);

    await asFamily(bob.token)
      .delete(`/api/family/photos/${photo.body.id}`)
      .expect(403);

    await asFamily(anne.token)
      .delete(`/api/family/photos/${photo.body.id}`)
      .expect(204);
  });
});
