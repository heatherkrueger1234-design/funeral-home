import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, vitalStatisticsTable } from "@workspace/db";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * The death certificate details.
 *
 * The social security number is the most sensitive thing this product
 * stores, so most of what is asserted here is about where it does *not* go.
 */
describe("vital statistics", () => {
  it("never returns the social security number to anyone", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: "123-45-6789", legalFirstName: "Margaret" })
      .expect(200);

    const familyView = await asFamily(token).get("/api/family/vitals").expect(200);
    const staffView = await staff.agent
      .get(`/api/cases/${row.id}/vitals`)
      .expect(200);

    for (const view of [familyView.body, staffView.body]) {
      expect(JSON.stringify(view)).not.toContain("123456789");
      expect(JSON.stringify(view)).not.toContain("123-45-6789");
      expect(view.hasSocialSecurityNumber).toBe(true);
    }

    // Staff get the last four, which is all anybody needs to confirm it.
    expect(staffView.body.socialSecurityNumberMasked).toBe("•••-••-6789");

    // And it is ciphertext at rest, not the digits.
    const [stored] = await db
      .select()
      .from(vitalStatisticsTable)
      .where(eq(vitalStatisticsTable.caseId, row.id));

    expect(stored!.socialSecurityNumber).not.toBeNull();
    expect(stored!.socialSecurityNumber).not.toContain("123456789");
  });

  it("rejects a number that is not nine digits", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: "12345" })
      .expect(400);

    // But clearing it is allowed.
    await asFamily(token)
      .put("/api/family/vitals")
      .send({ socialSecurityNumber: "" })
      .expect(200);
  });

  it("tells the director which case will stall on Wednesday", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const empty = await staff.agent
      .get(`/api/cases/${row.id}/vitals`)
      .expect(200);

    // The field that most often holds up a certificate.
    expect(empty.body.missingForFiling).toContain("motherMaidenName");
    expect(empty.body.missingForFiling).toContain("socialSecurityNumber");

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ motherMaidenName: "Braithwaite" })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/vitals`)
      .expect(200);

    expect(after.body.missingForFiling).not.toContain("motherMaidenName");
    expect(after.body.motherMaidenName).toBe("Braithwaite");
  });

  it("saves a field at a time, so a family can stop and come back", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ fatherLastName: "Hale" })
      .expect(200);

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ veteran: true, veteranBranch: "US Navy" })
      .expect(200);

    const seen = await asFamily(token).get("/api/family/vitals").expect(200);

    expect(seen.body.fatherLastName).toBe("Hale");
    // A veteran is entitled to a flag and a headstone, and families often do
    // not know that — so the answer has to survive.
    expect(seen.body.veteran).toBe(true);
    expect(seen.body.veteranBranch).toBe("US Navy");
    expect(seen.body.status).toBe("collecting");
  });

  it("stops the family editing once staff have verified it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ legalLastName: "Hale" })
      .expect(200);
    await asFamily(token).post("/api/family/vitals/submit").expect(200);

    const verified = await staff.agent
      .put(`/api/cases/${row.id}/vitals`)
      .send({ verified: true })
      .expect(200);

    expect(verified.body.status).toBe("verified");
    expect(verified.body.verifiedByName).toBe("Karen Voss");

    await asFamily(token)
      .put("/api/family/vitals")
      .send({ legalLastName: "Hayle" })
      .expect(409);

    // Staff can still correct what they verified.
    await staff.agent
      .put(`/api/cases/${row.id}/vitals`)
      .send({ legalLastName: "Hayle" })
      .expect(200);
  });

  it("ignores fields the caller is not allowed to set", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // A family cannot verify their own record, or move it to another home.
    await asFamily(token)
      .put("/api/family/vitals")
      .send({ legalFirstName: "Margaret", verified: true, funeralHomeId: 99 })
      .expect(200);

    const seen = await staff.agent
      .get(`/api/cases/${row.id}/vitals`)
      .expect(200);

    expect(seen.body.legalFirstName).toBe("Margaret");
    expect(seen.body.status).toBe("collecting");
    expect(seen.body.verifiedAt).toBeNull();
  });

  it("cannot be read across tenants", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street");
    const theirCase = await createCase(theirs);

    await mine.agent.get(`/api/cases/${theirCase.id}/vitals`).expect(404);
    await mine.agent
      .put(`/api/cases/${theirCase.id}/vitals`)
      .send({ legalFirstName: "Nope" })
      .expect(404);
  });
});
