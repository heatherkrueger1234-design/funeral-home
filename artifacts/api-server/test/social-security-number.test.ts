import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The one number this product asks for that could ruin somebody's year.
 *
 * Two failure modes, pulling in opposite directions, and the tests below
 * exist because the product spent a while failing at the second one while
 * trying very hard at the first.
 *
 * Leaking it is the obvious one: it must not come back in the vitals payload
 * either surface reads, must not be in the archive a home emails itself, and
 * must never be reachable with a family's link.
 *
 * Burying it is the one that actually happened. Masked everywhere with no way
 * to read it back, the field was write-only: a family handed it over, were
 * told the certificate needed it, and the home had to telephone and ask for
 * it again. A number nobody can use is not a number that has been protected.
 */
describe("the social security number", () => {
  const SSN = "123456789";

  it("is never in the payload either side reads", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: SSN })
      .expect(200);

    const asSeenByStaff = await staff.agent
      .get(`/api/cases/${row.id}/vitals`)
      .expect(200);
    const asSeenByFamily = await asFamily(family.token)
      .get("/api/family/vitals")
      .expect(200);

    for (const view of [asSeenByStaff.body, asSeenByFamily.body]) {
      expect(JSON.stringify(view)).not.toContain(SSN);
      expect(view.hasSocialSecurityNumber).toBe(true);
      expect(view.socialSecurityNumberMasked).toMatch(/6789$/);
    }
  });

  it("comes back in full when a director asks for it by name", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: "123-45-6789" })
      .expect(200);

    const revealed = await staff.agent
      .post(`/api/cases/${row.id}/vitals/social-security-number`)
      .expect(200);

    // Unformatted, because it is going into a state form field that wants
    // digits and a director should not have to strip the dashes back out.
    expect(revealed.body.socialSecurityNumber).toBe(SSN);
    expect(revealed.body.revealedByName).toBe("Karen Voss");
    expect(revealed.headers["cache-control"]).toContain("no-store");
  });

  it("records who looked, and when", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: SSN })
      .expect(200);

    const before = await staff.agent.get(`/api/cases/${row.id}/vitals`).expect(200);
    expect(before.body.ssnRevealedAt).toBeNull();

    await staff.agent
      .post(`/api/cases/${row.id}/vitals/social-security-number`)
      .expect(200);

    const after = await staff.agent.get(`/api/cases/${row.id}/vitals`).expect(200);
    expect(after.body.ssnRevealedAt).not.toBeNull();
    expect(after.body.ssnRevealedByName).toBe("Karen Voss");
  });

  it("says so plainly when there is no number to show", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/vitals/social-security-number`)
      .expect(404);
  });

  it("is not reachable with a family's link, or with no credential at all", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: SSN })
      .expect(200);

    /*
     * The family surface has no such route, and the staff one is behind the
     * session gate — so a family link gets 401 from the gate rather than 404
     * from a handler. Either way the number does not move.
     */
    const withLink = await asFamily(family.token).post(
      `/api/cases/${row.id}/vitals/social-security-number`,
    );
    expect(withLink.status).toBe(401);
    expect(JSON.stringify(withLink.body)).not.toContain(SSN);

    await request(app)
      .post(`/api/cases/${row.id}/vitals/social-security-number`)
      .expect(401);
  });

  it("is not reachable from another funeral home", async () => {
    const one = await signUpHome("Willowbank");
    const two = await signUpHome("Fairhaven");

    const row = await createCase(one);
    const family = await inviteFamily(one, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: SSN })
      .expect(200);

    const across = await two.agent.post(
      `/api/cases/${row.id}/vitals/social-security-number`,
    );
    expect(across.status).toBe(404);
    expect(JSON.stringify(across.body)).not.toContain(SSN);
  });

  it("stays out of the archive a home emails itself", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const family = await inviteFamily(staff, row.id);

    await asFamily(family.token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: SSN })
      .expect(200);

    const archive = await staff.agent
      .get(`/api/cases/${row.id}/export`)
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    // An export gets emailed, copied to a laptop and left in a downloads
    // folder. The masked form is in there; the number is not.
    expect((archive.body as Buffer).toString("latin1")).not.toContain(SSN);
  });
});
