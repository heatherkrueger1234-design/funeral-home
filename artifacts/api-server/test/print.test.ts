import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * The print studio.
 *
 * What matters is that a director cannot produce something broken: the sizes
 * are the trade's, the case's own details fill themselves in, text that would
 * overflow a card is refused, and a family sees a proof before two hundred
 * are printed.
 */
describe("templates", () => {
  it("offers real trade sizes, not invented ones", async () => {
    const staff = await signUpHome();
    const templates = await staff.agent.get("/api/print/templates").expect(200);

    const byKey = Object.fromEntries(
      templates.body.map((t: { key: string }) => [t.key, t]),
    );

    // A prayer card is what card stock is guillotined to.
    expect(byKey["prayer-card"].width).toBe(2.5);
    expect(byKey["prayer-card"].height).toBe(4.25);
    // A folded program is a letter sheet folded once.
    expect(byKey["program-folded"].width).toBe(5.5);
    expect(byKey["program-folded"].height).toBe(8.5);
    expect(byKey["program-folded"].panels).toBe(4);

    // Slots are named, so the UI can build the form without hardcoding.
    expect(byKey["prayer-card"].slots.map((s: { key: string }) => s.key)).toContain("verse");
  });
});

describe("putting a card together", () => {
  it("fills in what the case already knows", async () => {
    const staff = await signUpHome("Horan & McConaty");
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
      dateOfBirth: new Date("1931-03-04").toISOString(),
      dateOfDeath: new Date("2026-09-02").toISOString(),
      serviceAt: new Date("2026-09-18T13:00:00Z").toISOString(),
      serviceLocation: "St Mary's Chapel",
    });

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    // Nobody retypes the name or the dates.
    expect(item.body.resolved.name).toBe("Peggy Hale");
    expect(item.body.resolved.dates).toBe("1931 — 2026");
    expect(item.body.status).toBe("draft");
  });

  /*
   * The bug this catches got as far as the family's proof screen.
   *
   * The servers run UTC. `toLocaleString` with no `timeZone` reads the host
   * clock, so a nine o'clock Denver funeral rendered as "3:00 PM" — on the
   * prayer card, on the order of service, and on the proof whose entire job
   * is to catch exactly that before two hundred are printed.
   */
  it("prints the service time in the home's timezone, not the server's", async () => {
    const staff = await signUpHome();

    // 15:00 UTC is 09:00 in Denver, which is this product's default zone.
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      serviceAt: new Date("2026-09-26T15:00:00Z").toISOString(),
      serviceLocation: "St Mary's Chapel",
    });

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "program-folded" })
      .expect(201);

    const line = item.body.resolved.serviceLine as string;

    expect(line).toContain("9:00 AM");
    expect(line).not.toContain("3:00 PM");
    // The zone is named, so nobody has to guess which nine o'clock it was.
    expect(line).toContain("MDT");

    // And the rendered card agrees with the preview, to the minute.
    const render = await staff.agent
      .get(`/api/print/${item.body.id}/render`)
      .expect(200);

    expect(render.text).toContain("9:00 AM");
    expect(render.text).not.toContain("3:00 PM");
  });

  it("gives the family the same time on the proof as the card", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      serviceAt: new Date("2026-09-26T15:00:00Z").toISOString(),
    });

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "program-folded" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "proof", sharedWithFamily: true })
      .expect(200);

    const contact = await inviteFamily(staff, row.id);
    const family = asFamily(contact.token);
    const proofs = await family.get("/api/family/print").expect(200);

    expect(proofs.body).toHaveLength(1);
    expect(proofs.body[0].resolved.serviceLine).toContain("9:00 AM");
  });

  it("lets a director type over anything filled in", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    const edited = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { name: "Margaret Ellen Hale" } })
      .expect(200);

    expect(edited.body.resolved.name).toBe("Margaret Ellen Hale");
  });

  it("saves one field at a time without losing the others", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { verse: "In loving memory" } })
      .expect(200);

    const second = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { closing: "Horan & McConaty" } })
      .expect(200);

    // The studio saves as somebody types, so a merge is the only safe write.
    expect(second.body.values.verse).toBe("In loving memory");
    expect(second.body.values.closing).toBe("Horan & McConaty");
  });

  it("refuses text that would not fit on the card", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { verse: "x".repeat(5000) } })
      .expect(400);
  });

  it("ignores slots that are not on the template", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    const updated = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { verse: "Kept", somethingElse: "dropped" } })
      .expect(200);

    // `values` is JSON; an unchecked write there is where junk accumulates.
    expect(updated.body.values.verse).toBe("Kept");
    expect(updated.body.values.somethingElse).toBeUndefined();
  });

  it("will not take a photograph from another case", async () => {
    const staff = await signUpHome();
    const mine = await createCase(staff, { decedentLastName: "Mine" });
    const theirs = await createCase(staff, { decedentLastName: "Theirs" });
    const { token } = await inviteFamily(staff, theirs.id);

    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "a.png")
      .expect(201);

    const item = await staff.agent
      .post(`/api/cases/${mine.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ photoId: photo.body.id })
      .expect(400);
  });
});

describe("rendering", () => {
  it("produces a page sized in inches with bleed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    const { token } = await inviteFamily(staff, row.id);

    const photo = await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "gran.png")
      .expect(201);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ photoId: photo.body.id, values: { verse: "In loving memory" } })
      .expect(200);

    const render = await staff.agent
      .get(`/api/print/${item.body.id}/render`)
      .expect(200);

    expect(render.headers["content-type"]).toContain("text/html");

    // 2.5 + 0.125 bleed either side = 2.75in; 4.25 + 0.25 = 4.5in.
    expect(render.text).toContain("@page { size: 2.75in 4.5in;");
    expect(render.text).toContain("Margaret Hale");
    expect(render.text).toContain("In loving memory");
    // The photograph travels inside the file, so it can be emailed on.
    expect(render.text).toContain("data:image/png;base64,");
    // Never cached by a shared proxy: it is one family's card.
    expect(render.headers["cache-control"]).toContain("no-store");
  });

  it("escapes what a director typed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ values: { verse: "<script>alert(1)</script>" } })
      .expect(200);

    const render = await staff.agent
      .get(`/api/print/${item.body.id}/render`)
      .expect(200);

    expect(render.text).not.toContain("<script>alert(1)</script>");
    expect(render.text).toContain("&lt;script&gt;");
  });

  it("still renders when no photograph has been chosen", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "program-folded" })
      .expect(201);

    const render = await staff.agent
      .get(`/api/print/${item.body.id}/render`)
      .expect(200);

    // An empty frame, so it is obvious rather than a collapsed layout.
    expect(render.text).toContain("photo--empty");
  });
});

describe("proofs", () => {
  it("shows the family only what the home shared", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const draft = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    // A draft a director is still moving around is not a proof.
    let seen = await asFamily(token).get("/api/family/print").expect(200);
    expect(seen.body).toHaveLength(0);

    await staff.agent
      .put(`/api/print/${draft.body.id}`)
      .send({ status: "proof", sharedWithFamily: true })
      .expect(200);

    seen = await asFamily(token).get("/api/family/print").expect(200);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].status).toBe("proof");
  });

  it("records who signed it off, and lets it be reopened", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    const approved = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "approved" })
      .expect(200);
    expect(approved.body.approvedAt).not.toBeNull();

    const reopened = await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "draft" })
      .expect(200);
    expect(reopened.body.approvedAt).toBeNull();
  });

  it("lets the family open the rendered card behind a shared proof", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    const { token } = await inviteFamily(staff, row.id);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "proof", sharedWithFamily: true })
      .expect(200);

    const render = await asFamily(token)
      .get(`/api/family/print/${item.body.id}/render`)
      .expect(200);

    expect(render.headers["content-type"]).toContain("text/html");
    expect(render.text).toContain("Margaret Hale");
  });

  it("will not let the family open a card that has not been shared", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const draft = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await asFamily(token)
      .get(`/api/family/print/${draft.body.id}/render`)
      .expect(404);
  });

  it("will not let one family's link open another case's shared proof", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const other = await createCase(staff);
    const { token } = await inviteFamily(staff, other.id);

    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card" })
      .expect(201);

    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "proof", sharedWithFamily: true })
      .expect(200);

    await asFamily(token)
      .get(`/api/family/print/${item.body.id}/render`)
      .expect(404);
  });
});

/**
 * The family's answer. A proof used to go "with the family" and stay there,
 * because nothing a family could do moved it; these are the two things they
 * can now say, and the rules around who may say them.
 */
describe("the family answering a proof", () => {
  async function sharedProof() {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
    });
    const nextOfKin = await inviteFamily(staff, row.id, { name: "Anne Hale" });
    const cousin = await inviteFamily(staff, row.id, {
      name: "Rob Hale",
      role: "contributor",
    });
    const item = await staff.agent
      .post(`/api/cases/${row.id}/print`)
      .send({ templateKey: "prayer-card", title: "Prayer card" })
      .expect(201);
    await staff.agent
      .put(`/api/print/${item.body.id}`)
      .send({ status: "proof", sharedWithFamily: true })
      .expect(200);
    return { staff, row, nextOfKin, cousin, itemId: item.body.id as number };
  }

  it("tells the family in the thread when a proof is waiting on them", async () => {
    const { nextOfKin } = await sharedProof();
    const session = await asFamily(nextOfKin.token).get("/api/family/session").expect(200);
    expect(session.body.proofsToCheck).toBe(1);

    const thread = await asFamily(nextOfKin.token).get("/api/family/messages").expect(200);
    const bodies = JSON.stringify(thread.body);
    expect(bodies).toContain("ready for you to read");
  });

  it("lets the next of kin approve it, and says so to the director", async () => {
    const { staff, row, nextOfKin, itemId } = await sharedProof();

    const approved = await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.approvedByFamily).toBe(true);
    expect(approved.body.approvedByName).toBe("Anne Hale");

    const list = await staff.agent.get(`/api/cases/${row.id}/print`).expect(200);
    expect(list.body[0].approvedByName).toBe("Anne Hale");

    const thread = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(JSON.stringify(thread.body)).toContain("Please go ahead and print it");

    // Approving twice is a stale tab, not a second approval.
    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(409);
  });

  it("does not let a contributor sign it off, but does let them flag a mistake", async () => {
    const { staff, row, cousin, itemId } = await sharedProof();

    await asFamily(cousin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(403);

    const changed = await asFamily(cousin.token)
      .post(`/api/family/print/${itemId}/changes`)
      .send({ note: "Grandson is Jaxon, with an x." })
      .expect(200);
    expect(changed.body.status).toBe("draft");
    expect(changed.body.changesRequestedNote).toBe("Grandson is Jaxon, with an x.");
    expect(changed.body.changesRequestedBy).toBe("Rob Hale");

    const thread = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(JSON.stringify(thread.body)).toContain("Jaxon, with an x");
  });

  it("clears the family's note when the home sends the corrected proof", async () => {
    const { staff, nextOfKin, itemId } = await sharedProof();

    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/changes`)
      .send({ note: "Wrong year." })
      .expect(200);

    // Back with the home, so the family cannot approve the old version.
    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(409);

    const resent = await staff.agent
      .put(`/api/print/${itemId}`)
      .send({ status: "proof" })
      .expect(200);
    expect(resent.body.changesRequestedAt).toBeNull();
    expect(resent.body.changesRequestedNote).toBeNull();

    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(200);
  });

  it("refuses an empty note", async () => {
    const { nextOfKin, itemId } = await sharedProof();
    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/changes`)
      .send({ note: "   " })
      .expect(400);
  });

  it("will not let one family answer another case's proof", async () => {
    const { staff, itemId } = await sharedProof();
    const other = await createCase(staff);
    const stranger = await inviteFamily(staff, other.id);

    await asFamily(stranger.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(404);
    await asFamily(stranger.token)
      .post(`/api/family/print/${itemId}/changes`)
      .send({ note: "x" })
      .expect(404);
  });

  it("freezes an approved card's wording until it is reopened", async () => {
    const { staff, nextOfKin, itemId } = await sharedProof();
    await asFamily(nextOfKin.token)
      .post(`/api/family/print/${itemId}/approve`)
      .expect(200);

    await staff.agent
      .put(`/api/print/${itemId}`)
      .send({ values: { verse: "Something nobody checked" } })
      .expect(409);

    // The run size is not proofread, so it can still change.
    await staff.agent.put(`/api/print/${itemId}`).send({ quantity: 250 }).expect(200);

    // Reopening in the same request is what the studio does.
    const reopened = await staff.agent
      .put(`/api/print/${itemId}`)
      .send({ status: "draft", values: { verse: "Corrected" } })
      .expect(200);
    expect(reopened.body.approvedByName).toBeNull();
    expect(reopened.body.approvedByFamily).toBe(false);
  });
});

describe("the home's own snippets", () => {
  it("starts empty, because a home already has these", async () => {
    const staff = await signUpHome();
    const snippets = await staff.agent.get("/api/snippets").expect(200);

    // Nothing is seeded: most of what goes on a prayer card is somebody's
    // copyright, and a home's own list reflects its community anyway.
    expect(snippets.body).toEqual([]);
  });

  it("keeps what a home adds, and archives rather than deletes", async () => {
    const staff = await signUpHome();

    const created = await staff.agent
      .post("/api/snippets")
      .send({
        kind: "closing",
        title: "Our usual closing",
        body: "In loving memory, from all at the home.",
        clearedForPrint: true,
      })
      .expect(201);

    expect(created.body.clearedForPrint).toBe(true);

    await staff.agent.delete(`/api/snippets/${created.body.id}`).expect(204);

    const after = await staff.agent.get("/api/snippets").expect(200);
    expect(after.body).toHaveLength(0);
  });

  it("cannot be read across tenants", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street");

    const created = await theirs.agent
      .post("/api/snippets")
      .send({ title: "Theirs", body: "Private to them." })
      .expect(201);

    await mine.agent.put(`/api/snippets/${created.body.id}`).send({ title: "Mine", body: "x" }).expect(404);
    expect((await mine.agent.get("/api/snippets").expect(200)).body).toHaveLength(0);
  });
});
