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
