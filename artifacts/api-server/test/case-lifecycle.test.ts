import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * The whole product, in the order a real case happens: a death comes in, the
 * family is texted a link, they fill the asset drop, they talk to the
 * director, the service happens, the case closes, and the aftercare starts.
 */
describe("a case from intake to aftercare", () => {
  it("runs the full arc", async () => {
    const staff = await signUpHome("Horan & McConaty");

    /* --- the call comes in ------------------------------------------- */

    const serviceAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
      serviceAt: serviceAt.toISOString(),
      serviceLocation: "St Mary's Chapel",
    });

    // Preferred name wins: she was called Peggy.
    expect(row.displayName).toBe("Peggy Hale");
    expect(row.status).toBe("intake");

    /* --- the family is texted a link --------------------------------- */

    const { token } = await inviteFamily(staff, row.id, {
      name: "Anne Hale",
      relationship: "Daughter",
      email: "anne@example.com",
      role: "next_of_kin",
    });

    // Inviting the first family member makes the case live.
    const afterInvite = await staff.agent.get(`/api/cases/${row.id}`).expect(200);
    expect(afterInvite.body.status).toBe("active");
    expect(afterInvite.body.nextOfKinName).toBe("Anne Hale");

    /* --- the family opens it ----------------------------------------- */

    const session = await asFamily(token).get("/api/family/session").expect(200);

    expect(session.body.home.name).toBe("Horan & McConaty");
    expect(session.body.case.displayName).toBe("Peggy Hale");
    expect(session.body.photoLimit).toBe(50);
    expect(session.body.contact).not.toHaveProperty("tokenHash");

    /* --- the asset drop: photographs --------------------------------- */

    const photo = await asFamily(token)
      .post("/api/family/photos")
      .field("caption", "Mum at Skegness, 1974")
      .attach("file", PNG_BYTES, "skegness.png")
      .expect(201);

    expect(photo.body.caption).toBe("Mum at Skegness, 1974");
    expect(photo.body.uploadedByName).toBe("Anne Hale");
    expect(photo.body.isPortrait).toBe(false);

    // Choosing the portrait, with a crop stored as instructions.
    const portrait = await asFamily(token)
      .put("/api/family/portrait")
      .send({ photoId: photo.body.id, cropX: 0.1, cropY: 0.2, cropWidth: 0.5, cropHeight: 0.5 })
      .expect(200);

    expect(portrait.body.isPortrait).toBe(true);
    expect(portrait.body.cropX).toBeCloseTo(0.1);

    /* --- the asset drop: the obituary -------------------------------- */

    await asFamily(token)
      .put("/api/family/obituary")
      .send({
        fullName: "Margaret Ellen Hale",
        bornOn: "4 March 1931",
        birthPlace: "Leeds",
        diedOn: "2 September 2026",
        survivedBy: "her daughters Anne and Judith, and six grandchildren",
        precededBy: "her husband of 54 years, Ronald",
        biography: "Peggy taught at Beckett Park Primary for thirty-one years.",
        inLieuOfFlowers: "donations to Marie Curie",
      })
      .expect(200);

    const submitted = await asFamily(token)
      .post("/api/family/obituary/submit")
      .expect(200);
    expect(submitted.body.status).toBe("submitted");

    // The director composes a draft from the fields.
    const composed = await staff.agent
      .post(`/api/cases/${row.id}/obituary/compose`)
      .send({})
      .expect(200);

    expect(composed.body.draftText).toContain("Margaret Ellen Hale died on 2 September 2026");
    expect(composed.body.draftText).toContain("Preceded in death by her husband");
    expect(composed.body.draftText).toContain("In lieu of flowers, donations to Marie Curie");
    // Nothing was invented: a field left blank produces no sentence.
    expect(composed.body.draftText).not.toContain("undefined");
    expect(composed.body.draftText).not.toContain("null");

    /* --- the asset drop: hymns and pallbearers ------------------------ */

    await asFamily(token)
      .post("/api/family/selections")
      .send({ kind: "hymn", value: "The Lord's My Shepherd" })
      .expect(201);

    const pallbearer = await asFamily(token)
      .post("/api/family/selections")
      .send({ kind: "pallbearer", value: "Thomas Hale", attribution: "Grandson" })
      .expect(201);

    // Once the home confirms it, it is in the order of service at the printer.
    await staff.agent
      .put(`/api/selections/${pallbearer.body.id}`)
      .send({ confirmed: true })
      .expect(200);

    await asFamily(token)
      .delete(`/api/family/selections/${pallbearer.body.id}`)
      .expect(409);

    /* --- the timeline ------------------------------------------------- */

    const clothing = await staff.agent
      .post(`/api/cases/${row.id}/deadlines`)
      .send({
        title: "Deliver clothing to the funeral home",
        description: "Ask for Karen at the front desk.",
        dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const funeral = await staff.agent
      .post(`/api/cases/${row.id}/deadlines`)
      .send({ title: "Service at St Mary's Chapel", dueAt: serviceAt.toISOString(), isEvent: true })
      .expect(201);

    // The family ticks off what they have done...
    const done = await asFamily(token)
      .post(`/api/family/deadlines/${clothing.body.id}`)
      .send({ completed: true })
      .expect(200);
    expect(done.body.completedByName).toBe("Anne Hale");

    // ...but the funeral itself is not a task anybody completes.
    await asFamily(token)
      .post(`/api/family/deadlines/${funeral.body.id}`)
      .send({ completed: true })
      .expect(400);

    /* --- the one thread ----------------------------------------------- */

    await asFamily(token)
      .post("/api/family/messages")
      .send({ body: "What time does the florist arrive?" })
      .expect(201);

    const inbox = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(inbox.body.messages).toHaveLength(1);
    expect(inbox.body.messages[0].authorSide).toBe("family");
    expect(inbox.body.messages[0].authorName).toBe("Anne Hale");
    expect(inbox.body.locked).toBe(false);

    const reply = await staff.agent
      .post(`/api/cases/${row.id}/messages`)
      .send({ body: "They arrive at eleven. Nothing for you to do." })
      .expect(201);
    expect(reply.body.authorSide).toBe("home");
    expect(reply.body.authorName).toBe("Karen Voss");

    /* --- the director signs the obituary off -------------------------- */

    const approved = await staff.agent
      .post(`/api/cases/${row.id}/obituary/approve`)
      .expect(200);
    expect(approved.body.status).toBe("approved");

    // After that the family cannot quietly change what went to the printer.
    await asFamily(token)
      .put("/api/family/obituary")
      .send({ biography: "Actually, thirty-two years." })
      .expect(409);

    /* --- closing the case starts the aftercare ------------------------ */

    const closed = await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    expect(closed.body.status).toBe("closed");
    // A fortnight past the service, not past today.
    expect(new Date(closed.body.messagesLockAt).getTime()).toBe(
      serviceAt.getTime() + 14 * 24 * 60 * 60 * 1000,
    );

    const aftercare = await staff.agent.get(`/api/cases/${row.id}/aftercare`).expect(200);

    expect(aftercare.body).toHaveLength(1);
    expect(aftercare.body[0].brandedAs).toBe("Horan & McConaty");
    // Nothing is sent until the family says yes.
    expect(aftercare.body[0].status).toBe("pending");
    expect(aftercare.body[0].deliveries.map((d: { dayOffset: number }) => d.dayOffset)).toEqual(
      [30, 60, 90, 365],
    );

    /* --- and the family consents -------------------------------------- */

    const consented = await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    expect(consented.body.status).toBe("active");
    expect(consented.body.consentedAt).not.toBeNull();
  });

  it("closing twice does not enrol the family twice", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await inviteFamily(staff, row.id, { email: "anne@example.com" });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const aftercare = await staff.agent.get(`/api/cases/${row.id}/aftercare`).expect(200);
    expect(aftercare.body).toHaveLength(1);
  });

  it("does not enrol a contact with no way to reach them", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    await inviteFamily(staff, row.id, { name: "No Address" });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const aftercare = await staff.agent.get(`/api/cases/${row.id}/aftercare`).expect(200);
    expect(aftercare.body).toHaveLength(0);
  });
});
