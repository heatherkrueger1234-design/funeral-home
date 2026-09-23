import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  familyContactsTable,
  FAMILY_INVITE_CAP,
  FAMILY_LINK_TTL_MS,
} from "@workspace/db";
import { digestToken } from "../src/lib/family-link";
import {
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
  type StaffSession,
} from "./helpers";

/**
 * Passing the link on (`POST /family/relatives`).
 *
 * The family-side twin of a director adding a contact, and so held to the
 * same rules a director's link is: one case, a hashed token, revocable,
 * expiring. What is extra here is everything that stops a forwarded link
 * turning into a way to mint more links -- the `canInvite` gate, no
 * invitations from the invited, a per-case cap, and the home being told.
 */

async function nextOfKin(staff: StaffSession, caseId: number) {
  return inviteFamily(staff, caseId, { canInvite: true });
}

function tokenOf(link: string): string {
  return link.split("/f/")[1]!;
}

async function contactRow(id: number) {
  const [row] = await db
    .select()
    .from(familyContactsTable)
    .where(eq(familyContactsTable.id, id));
  return row!;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a relative added by the family", () => {
  it("gets their own working link to the same case, as a contributor who cannot invite", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", relationship: "Brother", phone: "(303) 555-0199" })
      .expect(201);

    // No Twilio or SMTP in the test environment: nothing could carry it, so
    // the link is handed back once, to copy.
    expect(res.body.sentBySms).toBe(false);
    expect(res.body.sentByEmail).toBe(false);
    expect(res.body.link).toContain("/f/");
    expect(res.body.relative).toMatchObject({
      name: "Tom Hale",
      relationship: "Brother",
      phone: "+13035550199",
      revoked: false,
      firstSeenAt: null,
    });
    expect(res.body.remaining).toBe(FAMILY_INVITE_CAP - 1);

    const tom = await asFamily(tokenOf(res.body.link))
      .get("/api/family/session")
      .expect(200);
    expect(tom.body.case.id).toBe(row.id);
    expect(tom.body.contact.name).toBe("Tom Hale");
    expect(tom.body.contact.role).toBe("contributor");
    expect(tom.body.contact.canInvite).toBe(false);
    expect(tom.body.contact.invitedByContactId).toBe(anne.contactId);
  });

  it("stores only the token's digest, like every other family link", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", email: "tom@example.com" })
      .expect(201);

    const token = tokenOf(res.body.link);
    const stored = await contactRow(res.body.relative.id);

    expect(stored.tokenHash).toBe(digestToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.caseId).toBe(row.id);
    expect(stored.funeralHomeId).toBe(staff.homeId);
    expect(stored.invitedByContactId).toBe(anne.contactId);
    expect(stored.invitedByUserId).toBeNull();
    // And it never comes back out: not in the list, not to the director.
    const list = await asFamily(anne.token).get("/api/family/relatives").expect(200);
    expect(JSON.stringify(list.body)).not.toContain(token);
    const console_ = await staff.agent.get(`/api/cases/${row.id}/contacts`).expect(200);
    expect(JSON.stringify(console_.body)).not.toContain(token);
    expect(JSON.stringify(console_.body)).not.toContain("tokenHash");
  });

  it("can be revoked by the director like any other link", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(201);
    const token = tokenOf(res.body.link);

    await staff.agent.delete(`/api/contacts/${res.body.relative.id}`).expect(204);
    await asFamily(token).get("/api/family/session").expect(401);

    const list = await asFamily(anne.token).get("/api/family/relatives").expect(200);
    expect(list.body.relatives[0].revoked).toBe(true);
  });

  it("never outlives the person who added them", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await db
      .update(familyContactsTable)
      .set({ expiresAt: soon })
      .where(eq(familyContactsTable.id, anne.contactId));

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(201);

    const stored = await contactRow(res.body.relative.id);
    expect(stored.expiresAt.getTime()).toBe(soon.getTime());
    expect(stored.expiresAt.getTime()).toBeLessThan(Date.now() + FAMILY_LINK_TTL_MS);
  });

  it("tells the home who added whom, in the thread and on the contact", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", relationship: "Brother", email: "tom@example.com" })
      .expect(201);

    const inbox = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(inbox.body.messages).toHaveLength(1);
    expect(inbox.body.messages[0]).toMatchObject({
      authorSide: "family",
      authorName: "Anne Hale",
    });
    expect(inbox.body.messages[0].body).toContain("Tom Hale (Brother)");

    const contacts = await staff.agent.get(`/api/cases/${row.id}/contacts`).expect(200);
    const tom = contacts.body.find((c: { id: number }) => c.id === res.body.relative.id);
    expect(tom.invitedByContactId).toBe(anne.contactId);
    const anneRow = contacts.body.find((c: { id: number }) => c.id === anne.contactId);
    expect(anneRow.invitedByContactId).toBeNull();
  });

  it("still records the invitation, without a note, once the thread has locked", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    await db
      .update(casesTable)
      .set({ messagesLockAt: new Date(Date.now() - 60_000) })
      .where(eq(casesTable.id, row.id));

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(201);

    const inbox = await staff.agent.get(`/api/cases/${row.id}/messages`).expect(200);
    expect(inbox.body.messages).toHaveLength(0);
    expect((await contactRow(res.body.relative.id)).invitedByContactId).toBe(
      anne.contactId,
    );
  });

  it("does not hand back the link when the text actually went", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+13035550100");
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        sent.push(init.body.get("Body") ?? "");
        return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
      }),
    );

    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(201);

    expect(res.body.sentBySms).toBe(true);
    expect(res.body.link).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Anne Hale asked us to send you your own link");

    // The text carried a working link to the same case.
    const token = sent[0]!.split("/f/")[1]!.trim();
    const tom = await asFamily(token).get("/api/family/session").expect(200);
    expect(tom.body.case.id).toBe(row.id);
  });
});

describe("who may pass the link on", () => {
  it("refuses a contact without canInvite, and adds nobody", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const cousin = await inviteFamily(staff, row.id, {
      name: "Cousin Jo",
      role: "contributor",
      canInvite: false,
    });

    const res = await asFamily(cousin.token)
      .post("/api/family/relatives")
      .send({ name: "Somebody", phone: "3035550199" })
      .expect(403);
    expect(res.body.error ?? res.body.message).toBeTruthy();

    const contacts = await staff.agent.get(`/api/cases/${row.id}/contacts`).expect(200);
    expect(contacts.body).toHaveLength(1);

    // And the list says so rather than failing, so the portal just hides it.
    const list = await asFamily(cousin.token).get("/api/family/relatives").expect(200);
    expect(list.body).toMatchObject({ canInvite: false, remaining: 0, relatives: [] });
  });

  it("does not let the invited invite in turn", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(201);

    await asFamily(tokenOf(res.body.link))
      .post("/api/family/relatives")
      .send({ name: "Tom's friend", phone: "3035550177" })
      .expect(403);
  });

  it("refuses the moment the director takes canInvite away", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    await staff.agent
      .put(`/api/contacts/${anne.contactId}`)
      .send({ canInvite: false })
      .expect(200);

    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(403);
  });

  it("refuses a revoked inviter outright", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    await staff.agent.delete(`/api/contacts/${anne.contactId}`).expect(204);

    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(401);

    const rows = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.caseId, row.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses an expired inviter outright", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    await db
      .update(familyContactsTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(familyContactsTable.id, anne.contactId));

    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(401);
  });

  it("cannot put anybody on another case, whatever the body says", async () => {
    const staff = await signUpHome();
    const mine = await createCase(staff);
    const theirs = await createCase(staff, { decedentLastName: "Other" });
    const anne = await nextOfKin(staff, mine.id);

    // Another home entirely, too.
    const other = await signUpHome("Another Home");
    const foreign = await createCase(other);
    const bob = await nextOfKin(other, foreign.id);

    const res = await asFamily(bob.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199", caseId: mine.id, funeralHomeId: staff.homeId })
      .expect(201);

    const stored = await contactRow(res.body.relative.id);
    expect(stored.caseId).toBe(foreign.id);
    expect(stored.funeralHomeId).toBe(other.homeId);

    // The new link opens Bob's case and nothing of Anne's.
    const tom = asFamily(tokenOf(res.body.link));
    const session = await tom.get("/api/family/session").expect(200);
    expect(session.body.case.id).toBe(foreign.id);

    for (const caseId of [mine.id, theirs.id]) {
      const rows = await db
        .select()
        .from(familyContactsTable)
        .where(
          and(
            eq(familyContactsTable.caseId, caseId),
            eq(familyContactsTable.name, "Tom Hale"),
          ),
        );
      expect(rows).toHaveLength(0);
    }
    const anneList = await asFamily(anne.token).get("/api/family/relatives").expect(200);
    expect(anneList.body.relatives).toHaveLength(0);
    expect(anneList.body.remaining).toBe(FAMILY_INVITE_CAP);
  });

  it("refuses once the case is closed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    await db
      .update(casesTable)
      .set({ status: "closed" })
      .where(eq(casesTable.id, row.id));

    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom Hale", phone: "3035550199" })
      .expect(409);
  });
});

describe("the cap", () => {
  it(`holds at ${FAMILY_INVITE_CAP} per case, counting the removed, across every inviter`, async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);
    const mark = await inviteFamily(staff, row.id, {
      name: "Mark Hale",
      canInvite: true,
    });

    const created: number[] = [];
    for (let index = 0; index < FAMILY_INVITE_CAP; index += 1) {
      const who = index % 2 === 0 ? anne : mark;
      const res = await asFamily(who.token)
        .post("/api/family/relatives")
        .send({ name: `Relative ${index}`, email: `r${index}@example.com` })
        .expect(201);
      created.push(res.body.relative.id);
    }

    // Removing some does not free their places.
    await staff.agent.delete(`/api/contacts/${created[0]}`).expect(204);
    await staff.agent.delete(`/api/contacts/${created[1]}`).expect(204);

    const refused = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "One more", email: "more@example.com" })
      .expect(409);
    expect(JSON.stringify(refused.body)).toContain("funeral home can add");

    const list = await asFamily(mark.token).get("/api/family/relatives").expect(200);
    expect(list.body.remaining).toBe(0);
    expect(list.body.relatives).toHaveLength(FAMILY_INVITE_CAP / 2);

    // The director is not bound by it.
    await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Added by the home" })
      .expect(201);
  });

  it("is not beaten by sending several at once", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);

    // Fill all but two places directly, then race five.
    await db.insert(familyContactsTable).values(
      Array.from({ length: FAMILY_INVITE_CAP - 2 }, (_, index) => ({
        funeralHomeId: staff.homeId,
        caseId: row.id,
        name: `Earlier ${index}`,
        tokenHash: digestToken(`earlier-${index}`),
        expiresAt: new Date(Date.now() + 60_000),
        invitedByContactId: anne.contactId,
      })),
    );

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        asFamily(anne.token)
          .post("/api/family/relatives")
          .send({ name: `Racer ${index}`, email: `racer${index}@example.com` }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });
});

describe("what a relative needs", () => {
  it("asks for a name and somewhere to send the link", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);
    const as = asFamily(anne.token);

    await as.post("/api/family/relatives").send({ phone: "3035550199" }).expect(400);
    await as.post("/api/family/relatives").send({ name: "   ", phone: "3035550199" }).expect(400);
    await as.post("/api/family/relatives").send({ name: "Tom" }).expect(400);
    await as.post("/api/family/relatives").send({ name: "Tom", phone: "  ", email: "" }).expect(400);
    await as.post("/api/family/relatives").send({ name: "Tom", phone: "ask Anne" }).expect(400);
    await as.post("/api/family/relatives").send({ name: "Tom", email: "tom at home" }).expect(400);
    await as
      .post("/api/family/relatives")
      .send({ name: "x".repeat(121), phone: "3035550199" })
      .expect(400);

    const rows = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.caseId, row.id));
    expect(rows).toHaveLength(1);
  });

  it("does not mint a second link for somebody who already has one", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const anne = await nextOfKin(staff, row.id);
    await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Tom Hale", phone: "303-555-0199" })
      .expect(201);

    const res = await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tommy", phone: "(303) 555 0199" })
      .expect(409);
    expect(JSON.stringify(res.body)).toContain("Tom Hale already has their own link");

    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom", email: "TOM@example.com" })
      .expect(201);
    await asFamily(anne.token)
      .post("/api/family/relatives")
      .send({ name: "Tom again", email: "tom@example.com" })
      .expect(409);
  });
});
