import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db, caseFormAnswersTable, homePolicyVersionsTable } from "@workspace/db";
import { signUpHome, createCase, inviteFamily, asFamily, type StaffSession } from "./helpers";

/**
 * The home's paperwork, and who is allowed to touch it.
 *
 * What is worth testing here is not that a form saves. It is the handful of
 * places where getting it wrong has a consequence outside the software: a
 * cousin signing a cremation authorization, one daughter's signature standing
 * in for a majority of four, a social security number coming back out in
 * plain text, or another home's case answering to this home's session.
 */

async function makeForm(
  staff: StaffSession,
  form: Record<string, unknown>,
  fields: Record<string, unknown>[],
): Promise<number> {
  const created = await staff.agent.post("/api/forms").send(form).expect(201);
  await staff.agent
    .put(`/api/forms/${created.body.id}/fields`)
    .send({ fields })
    .expect(200);
  return created.body.id as number;
}

async function assign(staff: StaffSession, caseId: number, formId: number) {
  const res = await staff.agent
    .post(`/api/cases/${caseId}/forms`)
    .send({ formId })
    .expect(201);
  return res.body.id as number;
}

/** A contact the home has recorded as holding the right of final disposition. */
async function makeAuthorizer(
  staff: StaffSession,
  caseId: number,
  tier: string,
  overrides: Record<string, unknown> = {},
) {
  const { contactId, token } = await inviteFamily(staff, caseId, overrides);

  await staff.agent
    .post(`/api/contacts/${contactId}/authority`)
    .send({ dispositionTier: tier })
    .expect(200);

  await asFamily(token)
    .put("/api/family/password")
    .send({ password: "willow-harbour-41" })
    .expect(204);

  return { contactId, token, password: "willow-harbour-41" };
}

describe("a home's own forms", () => {
  it("builds one, puts it on a case, and the family can see it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Release of effects", note: "What was with them when they came in." },
      [
        { key: "items", label: "Items released", required: true },
        { key: "received_by", label: "Received by" },
      ],
    );

    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    const list = await asFamily(token).get("/api/family/forms").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("Release of effects");
    expect(list.body[0].requiredCount).toBe(1);
    expect(list.body[0].answeredCount).toBe(0);
    expect(list.body[0].id).toBe(caseFormId);
  });

  it("keeps a form out of the family's list while a director prepares it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Draft" }, [
      { key: "a", label: "A" },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    await staff.agent
      .patch(`/api/cases/${row.id}/forms/${caseFormId}`)
      .send({ sharedWithFamily: false })
      .expect(200);

    const list = await asFamily(token).get("/api/family/forms").expect(200);
    expect(list.body).toHaveLength(0);

    // Not "forbidden": a director is still preparing it, and saying anything
    // else would tell a family about a document the home has not given them.
    await asFamily(token).get(`/api/family/forms/${caseFormId}`).expect(404);
  });

  it("never refuses a partial save, and never loses the rest of one", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Worksheet" }, [
      { key: "one", label: "One", required: true },
      { key: "two", label: "Two", required: true },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    const saved = await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({
        answers: [
          { fieldKey: "one", value: "a thing" },
          // A box the home removed while this page was open. Rejecting the
          // whole save over it would lose the answer above with it.
          { fieldKey: "gone", value: "orphaned" },
        ],
      })
      .expect(200);

    expect(saved.body.complete).toBe(false);
    expect(saved.body.answeredCount).toBe(1);
    expect(saved.body.fields.find((f: { key: string }) => f.key === "one").value).toBe(
      "a thing",
    );
  });

  it("arrives filled in from what the case already knows", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });

    const formId = await makeForm(staff, { name: "Cemetery instruction" }, [
      {
        key: "full_name",
        label: "Full name of the deceased",
        required: true,
        prefillFrom: "decedent.fullName",
      },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    const res = await asFamily(token)
      .get(`/api/family/forms/${caseFormId}`)
      .expect(200);

    const field = res.body.fields[0];
    expect(field.suggested).toBe("Margaret Hale");
    // Suggested, not answered: a box nobody has looked at has to keep reading
    // as outstanding, or "what is left to do" quietly becomes a lie.
    expect(field.hasValue).toBe(false);
    expect(res.body.answeredCount).toBe(0);
  });

  it("refuses a prefill source that names nothing on a case", async () => {
    const staff = await signUpHome();
    const created = await staff.agent
      .post("/api/forms")
      .send({ name: "Worksheet" })
      .expect(201);

    await staff.agent
      .put(`/api/forms/${created.body.id}/fields`)
      .send({
        fields: [{ key: "x", label: "X", prefillFrom: "decedent.shoeSize" }],
      })
      .expect(400);
  });
});

describe("a box the home marked sensitive", () => {
  it("is never read back to the family, and is masked for staff", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Benefits claim" }, [
      { key: "policy", label: "Policy number", sensitive: true },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "policy", value: "PRU-4417-8890" }] })
      .expect(200);

    const family = await asFamily(token)
      .get(`/api/family/forms/${caseFormId}`)
      .expect(200);

    expect(family.body.fields[0].value).toBeNull();
    expect(family.body.fields[0].masked).toBeNull();
    expect(family.body.fields[0].hasValue).toBe(true);

    const console_ = await staff.agent
      .get(`/api/cases/${row.id}/forms/${caseFormId}`)
      .expect(200);

    expect(console_.body.fields[0].masked).toBe("••••8890");
    expect(console_.body.fields[0].value).toBeNull();

    const [stored] = await db
      .select()
      .from(caseFormAnswersTable)
      .where(eq(caseFormAnswersTable.caseId, row.id as number));

    expect(stored!.value).not.toContain("PRU-4417-8890");
  });
});

describe("the gate on an authorizing form", () => {
  it("is forced onto anything the home calls an authorization", async () => {
    const staff = await signUpHome();

    const res = await staff.agent
      .post("/api/forms")
      .send({
        name: "Cremation authorization",
        kind: "authorization",
        // A home that picked the wrong level in a dropdown gets a form that
        // behaves correctly rather than a lecture about a statute.
        requiredLevel: "arranging",
      })
      .expect(201);

    expect(res.body.requiredLevel).toBe("authorizing");
  });

  it("refuses a lower-level contact at the API, not merely in the UI", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);

    // An `arranging` daughter: the default level, and the one most people have.
    const { token } = await inviteFamily(staff, row.id as number, {
      name: "Anne Hale",
    });

    // She cannot see it in her list...
    const list = await asFamily(token).get("/api/family/forms").expect(200);
    expect(list.body).toHaveLength(0);

    // ...cannot read it by guessing the id...
    await asFamily(token).get(`/api/family/forms/${caseFormId}`).expect(404);

    // ...cannot fill it in...
    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "wishes", value: "cremation" }] })
      .expect(404);

    // ...and cannot sign it, password or no password.
    await asFamily(token)
      .put("/api/family/password")
      .send({ password: "willow-harbour-41" })
      .expect(204);

    await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password: "willow-harbour-41", signedName: "Anne Hale" })
      .expect(403);
  });

  it("stops even the authorizing contact while the disposition is disputed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token, password } = await makeAuthorizer(
      staff,
      row.id as number,
      "surviving_spouse",
    );

    await staff.agent
      .put(`/api/cases/${row.id}/disposition-dispute`)
      .send({ disputed: true, note: "Two daughters, no agreement." })
      .expect(200);

    await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password, signedName: "Anne Hale" })
      .expect(409);
  });

  it("will not take a signature without the password", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await makeAuthorizer(staff, row.id as number, "surviving_spouse");

    await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ signedName: "Anne Hale" })
      .expect(401);

    await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password: "not-the-one-99", signedName: "Anne Hale" })
      .expect(401);
  });
});

describe("what an authorization records", () => {
  it("keeps the tier claimed, the signature, and who at the home checked it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token, password, contactId } = await makeAuthorizer(
      staff,
      row.id as number,
      "surviving_spouse",
    );

    const signed = await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password, signedName: "Anne Hale", signedRelationship: "wife" })
      .expect(201);

    expect(signed.body.claimedTier).toBe("surviving_spouse");
    expect(signed.body.requiresMajority).toBe(false);
    expect(signed.body.signedByContactId).toBe(contactId);
    expect(signed.body.verifiedAt).toBeNull();

    const verified = await staff.agent
      .post(`/api/cases/${row.id}/authorizations/${signed.body.id}/verify`)
      .send({ verificationNote: "Marriage certificate seen, 1967." })
      .expect(200);

    expect(verified.body.verifiedByName).toBe("Karen Voss");
    expect(verified.body.verifiedAt).not.toBeNull();

    // Once. A second look that reaches a different conclusion is a new
    // authorization, not a rewrite of this one.
    await staff.agent
      .post(`/api/cases/${row.id}/authorizations/${signed.body.id}/verify`)
      .send({ verificationNote: "Actually, no." })
      .expect(409);
  });

  it("is append-only: a correction leaves the first one where it is", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);

    await staff.agent
      .post(`/api/cases/${row.id}/authorizations`)
      .send({
        caseFormId,
        claimedTier: "surviving_spouse",
        signedName: "Anne Hale",
      })
      .expect(201);

    await staff.agent
      .post(`/api/cases/${row.id}/authorizations`)
      .send({
        caseFormId,
        claimedTier: "appointed_personal_representative",
        signedName: "John Hale",
      })
      .expect(201);

    const all = await staff.agent
      .get(`/api/cases/${row.id}/authorizations`)
      .expect(200);

    expect(all.body).toHaveLength(2);
    expect(all.body[0].signedName).toBe("Anne Hale");
    expect(all.body[0].claimedTier).toBe("surviving_spouse");
  });

  it("stops taking answers once it has been signed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "pacemaker", label: "Anything that must be removed first" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token, password } = await makeAuthorizer(
      staff,
      row.id as number,
      "surviving_spouse",
    );

    // Before: the person signing it fills it in.
    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "pacemaker", value: "A pacemaker" }] })
      .expect(200);

    await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password, signedName: "Anne Hale" })
      .expect(201);

    // After: it says what it said when it was signed. Neither side may drift
    // the live answers away from the snapshot.
    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "pacemaker", value: "Actually, none" }] })
      .expect(409);

    await staff.agent
      .put(`/api/cases/${row.id}/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "pacemaker", value: "Actually, none" }] })
      .expect(409);
  });

  it("refuses to be recorded against a form that is not an authorization", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Worksheet" }, [
      { key: "a", label: "A" },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);

    await staff.agent
      .post(`/api/cases/${row.id}/authorizations`)
      .send({ caseFormId, claimedTier: "surviving_spouse", signedName: "Anne" })
      .expect(400);
  });
});

describe("a tier that needs a majority", () => {
  it("records every consenting person separately, and one is not a majority", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token, password } = await makeAuthorizer(
      staff,
      row.id as number,
      "adult_children",
    );

    const signed = await asFamily(token)
      .post(`/api/family/forms/${caseFormId}/authorize`)
      .send({ password, signedName: "Anne Hale", signedRelationship: "daughter" })
      .expect(201);

    expect(signed.body.requiresMajority).toBe(true);
    expect(signed.body.consentCount).toBe(1);
    // Nobody has said how many children there are, so the software says it
    // does not know rather than implying a majority it cannot see.
    expect(signed.body.majorityRecorded).toBeNull();

    const counted = await staff.agent
      .post(`/api/cases/${row.id}/authorizations/${signed.body.id}/consents`)
      .send({ personName: "John Hale", relationship: "son", channel: "telephone" })
      .expect(201);

    expect(counted.body.consents).toHaveLength(2);
    expect(counted.body.consents.map((c: { personName: string }) => c.personName)).toEqual([
      "Anne Hale",
      "John Hale",
    ]);
    expect(counted.body.consents[1].channel).toBe("telephone");
    expect(counted.body.consents[1].recordedByName).toBe("Karen Voss");
  });

  it("counts a majority only once the home says how many people there are", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);

    const recorded = await staff.agent
      .post(`/api/cases/${row.id}/authorizations`)
      .send({
        caseFormId,
        claimedTier: "adult_children",
        tierMemberCount: 4,
        signedName: "Anne Hale",
        consents: [{ personName: "Anne Hale", relationship: "daughter" }],
      })
      .expect(201);

    // One of four. A signature saying "I speak for a majority of the
    // surviving adult children" is exactly what this refuses to accept.
    expect(recorded.body.majorityRecorded).toBe(false);

    for (const name of ["John Hale", "Ruth Hale"]) {
      await staff.agent
        .post(`/api/cases/${row.id}/authorizations/${recorded.body.id}/consents`)
        .send({ personName: name })
        .expect(201);
    }

    const three = await staff.agent
      .get(`/api/cases/${row.id}/authorizations`)
      .expect(200);

    expect(three.body[0].consentCount).toBe(3);
    expect(three.body[0].majorityRecorded).toBe(true);
  });
});

describe("the seventy-two hours", () => {
  it("counts from custody, not from the death, and says who files it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const custody = new Date("2026-03-02T09:00:00.000Z");

    const res = await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({ custodyTakenAt: custody.toISOString() })
      .expect(200);

    expect(new Date(res.body.dueAt).toISOString()).toBe("2026-03-05T09:00:00.000Z");
    expect(res.body.filingNotice).toContain("We do not file this");
    expect(res.body.filingNotice).toContain("EDRS");
  });

  it("lists the boxes only the family can answer, and nothing else", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const formId = await makeForm(
      staff,
      { name: "Vital statistics worksheet", blocksCertificate: true },
      [
        {
          key: "mother_maiden",
          label: "Mother's name before she married",
          required: true,
          onlyFamilyKnows: true,
        },
        // Required, but the director can find it. Not a blocker.
        { key: "place_of_death", label: "Place of death", required: true },
        // Only the family knows it, but nothing waits on it.
        { key: "schooling", label: "Years of school", onlyFamilyKnows: true },
      ],
    );
    const caseFormId = await assign(staff, row.id as number, formId);

    const before = await staff.agent
      .get(`/api/cases/${row.id}/certificate`)
      .expect(200);

    expect(before.body.outstanding).toHaveLength(1);
    expect(before.body.outstanding[0].caseFormId).toBe(caseFormId);
    expect(before.body.outstanding[0].fields).toEqual([
      { key: "mother_maiden", label: "Mother's name before she married" },
    ]);

    const { token } = await inviteFamily(staff, row.id as number);
    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "mother_maiden", value: "Thornton" }] })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/certificate`)
      .expect(200);

    expect(after.body.outstanding).toHaveLength(0);
  });

  it("puts what the certificate needs in front of what it does not", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const later = await makeForm(staff, { name: "Veteran's benefits" }, [
      { key: "a", label: "A" },
    ]);
    const first = await makeForm(
      staff,
      { name: "Vital statistics worksheet", blocksCertificate: true },
      [{ key: "b", label: "B" }],
    );

    await assign(staff, row.id as number, later);
    await assign(staff, row.id as number, first);

    const res = await staff.agent.get(`/api/cases/${row.id}/forms`).expect(200);
    expect(res.body.map((f: { name: string }) => f.name)).toEqual([
      "Vital statistics worksheet",
      "Veteran's benefits",
    ]);
  });

  it("shows no clock at all on the family surface", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Vital statistics worksheet", blocksCertificate: true },
      [{ key: "a", label: "A", required: true, onlyFamilyKnows: true }],
    );
    await assign(staff, row.id as number, formId);

    await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({ custodyTakenAt: new Date().toISOString() })
      .expect(200);

    const theirs = await asFamily((await inviteFamily(staff, row.id as number)).token)
      .get("/api/family/forms")
      .expect(200);

    // A countdown is right for a director and wrong for a widow. The same
    // urgency reaches this surface as an ordering and never as a number of
    // hours, so nothing the family is sent carries one.
    const wire = JSON.stringify(theirs.body);
    expect(wire).not.toContain("hoursRemaining");
    expect(wire).not.toContain("dueAt");
    expect(wire).not.toContain("custodyTakenAt");

    const director = await staff.agent
      .get(`/api/cases/${row.id}/certificate`)
      .expect(200);

    expect(director.body.hoursRemaining).toBeTypeOf("number");
  });
});

describe("a note against a box", () => {
  it("lands at the blank, and is cleared by the answer rather than by anybody", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Worksheet" }, [
      { key: "mother_maiden", label: "Mother's maiden name", required: true },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    await staff.agent
      .post(`/api/cases/${row.id}/forms/${caseFormId}/flags`)
      .send({
        fieldKey: "mother_maiden",
        note: "The registrar needs her name before she married, not after.",
      })
      .expect(200);

    const seen = await asFamily(token)
      .get(`/api/family/forms/${caseFormId}`)
      .expect(200);

    expect(seen.body.fields[0].note).toContain("before she married");

    const answered = await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({ answers: [{ fieldKey: "mother_maiden", value: "Thornton" }] })
      .expect(200);

    expect(answered.body.fields[0].note).toBeNull();
    expect(answered.body.complete).toBe(true);
  });

  it("will not be raised against a box that does not exist", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Worksheet" }, [
      { key: "a", label: "A" },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);

    await staff.agent
      .post(`/api/cases/${row.id}/forms/${caseFormId}/flags`)
      .send({ fieldKey: "not_a_box", note: "..." })
      .expect(400);
  });
});

describe("printing it off the page", () => {
  it("gives the family a sheet of paper with no account and no sensitive box on it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(staff, { name: "Release of effects" }, [
      { key: "items", label: "Items released" },
      { key: "policy", label: "Policy number", sensitive: true },
    ]);
    const caseFormId = await assign(staff, row.id as number, formId);
    const { token } = await inviteFamily(staff, row.id as number);

    await asFamily(token)
      .put(`/api/family/forms/${caseFormId}/answers`)
      .send({
        answers: [
          { fieldKey: "items", value: "A wedding ring and a wristwatch" },
          { fieldKey: "policy", value: "PRU-4417-8890" },
        ],
      })
      .expect(200);

    const res = await asFamily(token)
      .get(`/api/family/forms/${caseFormId}/render`)
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("A wedding ring and a wristwatch");
    expect(res.text).toContain("Items released");
    expect(res.text).not.toContain("PRU-4417-8890");
    expect(res.text).toContain("given to the funeral home");
  });

  it("prints the signature, the tier claimed and every consenting person", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const formId = await makeForm(
      staff,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "wishes", label: "Instructions" }],
    );
    const caseFormId = await assign(staff, row.id as number, formId);

    const recorded = await staff.agent
      .post(`/api/cases/${row.id}/authorizations`)
      .send({
        caseFormId,
        claimedTier: "adult_children",
        tierMemberCount: 3,
        signedName: "Anne Hale",
        signedRelationship: "daughter",
        consents: [
          { personName: "Anne Hale", relationship: "daughter" },
          { personName: "John Hale", relationship: "son", channel: "telephone" },
        ],
      })
      .expect(201);

    expect(recorded.body.majorityRecorded).toBe(true);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/forms/${caseFormId}/render`)
      .expect(200);

    expect(res.text).toContain("Anne Hale");
    expect(res.text).toContain("John Hale");
    expect(res.text).toContain("adult children");
    expect(res.text).toContain("Not yet verified");
  });
});

describe("the home's versioned policies", () => {
  it("publishes new wording as a new version and leaves the old one alone", async () => {
    const staff = await signUpHome();

    const created = await staff.agent
      .post("/api/policies")
      .send({
        kind: "privacy",
        title: "How we look after your photographs",
        body: "We keep them until you ask us not to.",
      })
      .expect(201);

    expect(created.body.currentVersion.version).toBe(1);

    await staff.agent
      .post(`/api/policies/${created.body.id}/versions`)
      .send({ body: "We keep them until you ask us not to. You may ask at any time.", summary: "Said when." })
      .expect(201);

    const versions = await staff.agent
      .get(`/api/policies/${created.body.id}/versions`)
      .expect(200);

    expect(versions.body).toHaveLength(2);
    expect(versions.body[0].version).toBe(2);

    const stored = await db
      .select()
      .from(homePolicyVersionsTable)
      .where(eq(homePolicyVersionsTable.policyId, created.body.id));

    // The words a family already read are still exactly the words they read.
    expect(stored.find((v) => v.version === 1)!.body).toBe(
      "We keep them until you ask us not to.",
    );
  });

  it("records who was shown which version, and keeps being shown apart from agreeing", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId, token } = await inviteFamily(staff, row.id as number);

    const created = await staff.agent
      .post("/api/policies")
      .send({ kind: "terms", title: "Our terms", body: "The terms." })
      .expect(201);

    const seen = await asFamily(token).get("/api/family/policies").expect(200);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].shownAt).not.toBeNull();
    expect(seen.body[0].acknowledgedAt).toBeNull();

    const versionId = seen.body[0].versionId;

    await asFamily(token)
      .post(`/api/family/policies/${versionId}/acknowledge`)
      .send({ name: "Anne Hale" })
      .expect(200);

    const record = await staff.agent.get(`/api/cases/${row.id}/policies`).expect(200);

    expect(record.body).toHaveLength(1);
    expect(record.body[0].contactId).toBe(contactId);
    expect(record.body[0].policyTitle).toBe("Our terms");
    expect(record.body[0].acknowledgedName).toBe("Anne Hale");
    expect(record.body[0].version).toBe(1);
    void created;
  });

  it("stops offering a retired document without losing what was shown", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id as number);

    const created = await staff.agent
      .post("/api/policies")
      .send({ title: "Old terms", body: "The old terms." })
      .expect(201);

    await asFamily(token).get("/api/family/policies").expect(200);

    await staff.agent
      .patch(`/api/policies/${created.body.id}`)
      .send({ retired: true })
      .expect(200);

    const now = await asFamily(token).get("/api/family/policies").expect(200);
    expect(now.body).toHaveLength(0);

    const record = await staff.agent.get(`/api/cases/${row.id}/policies`).expect(200);
    expect(record.body).toHaveLength(1);
  });
});

describe("one home cannot reach another home's paperwork", () => {
  it("does not find a form belonging to somebody else", async () => {
    const ours = await signUpHome("Horan & McConaty");
    const theirs = await signUpHome("Olinger");

    const theirForm = await makeForm(theirs, { name: "Theirs" }, [
      { key: "a", label: "A" },
    ]);

    await ours.agent.get(`/api/forms/${theirForm}`).expect(404);

    const row = await createCase(ours);
    await ours.agent
      .post(`/api/cases/${row.id}/forms`)
      .send({ formId: theirForm })
      .expect(404);
  });

  it("does not let one family read the form on another family's case", async () => {
    const staff = await signUpHome();
    const mine = await createCase(staff, { decedentFirstName: "Margaret" });
    const other = await createCase(staff, { decedentFirstName: "Edward" });

    const formId = await makeForm(staff, { name: "Worksheet" }, [
      { key: "a", label: "A" },
    ]);
    const otherCaseForm = await assign(staff, other.id as number, formId);
    await assign(staff, mine.id as number, formId);

    const { token } = await inviteFamily(staff, mine.id as number);

    await asFamily(token).get(`/api/family/forms/${otherCaseForm}`).expect(404);
    await asFamily(token)
      .put(`/api/family/forms/${otherCaseForm}/answers`)
      .send({ answers: [{ fieldKey: "a", value: "nope" }] })
      .expect(404);
  });

  it("does not verify another home's authorization", async () => {
    const ours = await signUpHome("Horan & McConaty");
    const theirs = await signUpHome("Olinger");

    const theirCase = await createCase(theirs);
    const theirForm = await makeForm(
      theirs,
      { name: "Cremation authorization", kind: "authorization" },
      [{ key: "a", label: "A" }],
    );
    const theirCaseForm = await assign(theirs, theirCase.id as number, theirForm);

    const recorded = await theirs.agent
      .post(`/api/cases/${theirCase.id}/authorizations`)
      .send({ caseFormId: theirCaseForm, claimedTier: "surviving_spouse", signedName: "X" })
      .expect(201);

    const ourCase = await createCase(ours);

    await ours.agent
      .post(`/api/cases/${ourCase.id}/authorizations/${recorded.body.id}/verify`)
      .send({ verificationNote: "..." })
      .expect(404);
  });
});
