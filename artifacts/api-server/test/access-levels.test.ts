import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import {
  db,
  platformAdminsTable,
  familyContactsTable,
  atLeast,
  canAuthorize,
} from "@workspace/db";
import { hashPassword } from "../src/lib/auth";
import { signUpHome, createCase, inviteFamily, asFamily } from "./helpers";

/**
 * Who may do what, and — mostly — who may not.
 *
 * Almost every test here is about something being refused. That is the point:
 * the failures worth catching in this codebase are a person reaching data or
 * an action that is not theirs, and a test suite that only walks happy paths
 * cannot fail that way.
 */

let sequence = 0;

/** A platform admin, with the agent that carries their own cookie. */
async function signInAdmin(role: "owner" | "support" = "owner") {
  sequence += 1;
  const email = `admin${sequence}@example.com`;
  const password = "correct-horse-battery";

  const [admin] = await db
    .insert(platformAdminsTable)
    .values({
      email,
      passwordHash: await hashPassword(password),
      displayName: "Heather",
      role,
    })
    .returning();

  const agent = request.agent(app);
  await agent.post("/api/admin/auth/login").send({ email, password }).expect(200);

  return { agent, adminId: admin!.id, email, password };
}

describe("the platform account is not a funeral home account", () => {
  it("signs in, and says who it is", async () => {
    const { agent, email } = await signInAdmin();

    const res = await agent.get("/api/admin/auth/me").expect(200);

    expect(res.body.email).toBe(email);
    expect(res.body.role).toBe("owner");
    // The hash never leaves the server, in either direction.
    expect(res.body).not.toHaveProperty("passwordHash");
    expect(res.body.hasPassword).toBe(true);
  });

  it("does not let a director in through the platform door", async () => {
    const staff = await signUpHome();

    // A perfectly valid staff session cookie, presented to the admin surface.
    await staff.agent.get("/api/admin/auth/me").expect(401);
  });

  it("does not let a platform admin in through the staff door", async () => {
    const { agent } = await signInAdmin();

    // The reverse, which matters more: this account can read across every
    // home, so a staff route that accepted it would hand over everybody.
    await agent.get("/api/auth/me").expect(401);
    await agent.get("/api/cases").expect(401);
  });

  it("answers the same way for a wrong password and an unknown address", async () => {
    const { email } = await signInAdmin();

    const wrongPassword = await request(app)
      .post("/api/admin/auth/login")
      .send({ email, password: "not-the-password" })
      .expect(401);

    const noSuchAccount = await request(app)
      .post("/api/admin/auth/login")
      .send({ email: "nobody@example.com", password: "not-the-password" })
      .expect(401);

    // Distinguishing them would say which addresses are ours.
    expect(wrongPassword.body.message).toBe(noSuchAccount.body.message);
  });

  it("stops letting a deactivated admin in, without deleting anything", async () => {
    const { agent, adminId } = await signInAdmin();

    await agent.get("/api/admin/auth/me").expect(200);

    await db
      .update(platformAdminsTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(platformAdminsTable.id, adminId));

    // The session is still in the table; the account is what stopped working.
    await agent.get("/api/admin/auth/me").expect(401);
  });
});

describe("family access levels", () => {
  it("compares levels in order, and treats nonsense as no access", () => {
    expect(atLeast({ accessLevel: "authorizing" }, "arranging")).toBe(true);
    expect(atLeast({ accessLevel: "arranging" }, "arranging")).toBe(true);
    expect(atLeast({ accessLevel: "viewing" }, "arranging")).toBe(false);

    // A value that only gets into the column by hand is not a free pass.
    expect(atLeast({ accessLevel: "wheelbarrow" }, "viewing")).toBe(false);
  });

  it("starts a new contact at arranging, which is what they could always do", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId } = await inviteFamily(staff, row.id as number);

    const res = await staff.agent
      .get(`/api/cases/${row.id}/contacts`)
      .expect(200);

    const contact = res.body.find((c: { id: number }) => c.id === contactId);
    expect(contact.accessLevel).toBe("arranging");
    expect(contact.hasPassword).toBe(false);
    expect(contact.dispositionTier).toBeNull();
  });

  it("will not raise somebody to authorizing without a determination", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId } = await inviteFamily(staff, row.id as number);

    // `authorizing` is deliberately not a value this endpoint accepts.
    await staff.agent
      .patch(`/api/contacts/${contactId}/access`)
      .send({ accessLevel: "authorizing" })
      .expect(400);
  });

  it("records who holds the right of final disposition, and who said so", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId } = await inviteFamily(staff, row.id as number);

    const res = await staff.agent
      .post(`/api/contacts/${contactId}/authority`)
      .send({ dispositionTier: "surviving_spouse" })
      .expect(200);

    expect(res.body.accessLevel).toBe("authorizing");
    expect(res.body.dispositionTier).toBe("surviving_spouse");
    expect(res.body.authorityRecordedAt).not.toBeNull();

    const [stored] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, contactId));

    // The director's name stays against their determination.
    expect(stored!.authorityRecordedByUserId).toBe(staff.userId);
  });

  it("only ever has one authorizing contact on a case", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const first = await inviteFamily(staff, row.id as number, { name: "Anne Hale" });
    const second = await inviteFamily(staff, row.id as number, { name: "John Hale" });

    await staff.agent
      .post(`/api/contacts/${first.contactId}/authority`)
      .send({ dispositionTier: "adult_children" })
      .expect(200);

    await staff.agent
      .post(`/api/contacts/${second.contactId}/authority`)
      .send({ dispositionTier: "surviving_spouse" })
      .expect(200);

    const res = await staff.agent.get(`/api/cases/${row.id}/contacts`).expect(200);
    const authorizing = res.body.filter(
      (c: { accessLevel: string }) => c.accessLevel === "authorizing",
    );

    // Two people who both believe they are authorizing is the dispute this is
    // meant to surface, not a state to store.
    expect(authorizing).toHaveLength(1);
    expect(authorizing[0].id).toBe(second.contactId);

    const demoted = res.body.find((c: { id: number }) => c.id === first.contactId);
    expect(demoted.dispositionTier).toBeNull();
    expect(demoted.authorityRecordedAt).toBeNull();
  });

  it("clears the determination when somebody is stepped back down", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId } = await inviteFamily(staff, row.id as number);

    await staff.agent
      .post(`/api/contacts/${contactId}/authority`)
      .send({ dispositionTier: "surviving_spouse" })
      .expect(200);

    const res = await staff.agent
      .patch(`/api/contacts/${contactId}/access`)
      .send({ accessLevel: "viewing" })
      .expect(200);

    // A recorded authority outliving the access it justified is exactly the
    // stale row somebody later mistakes for current.
    expect(res.body.dispositionTier).toBeNull();
    expect(res.body.authorityRecordedAt).toBeNull();
  });
});

describe("family passwords", () => {
  it("is not a wall in front of the link", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id as number);

    // No password set, and the portal opens anyway. This is the whole
    // argument for the link: a registration form is where a next of kin
    // three days bereaved is lost.
    await asFamily(token).get("/api/family/session").expect(200);
  });

  it("lets the family choose one, then requires the old one to change it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id as number);
    const family = asFamily(token);

    await family.put("/api/family/password").send({ password: "willow-harbour-41" }).expect(204);

    // A forwarded link must not be able to lock the real recipient out.
    await family
      .put("/api/family/password")
      .send({ password: "something-else-22" })
      .expect(401);

    await family
      .put("/api/family/password")
      .send({ password: "something-else-22", currentPassword: "willow-harbour-41" })
      .expect(204);
  });

  it("refuses a password short enough to guess", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id as number);

    await asFamily(token).put("/api/family/password").send({ password: "short" }).expect(400);
  });

  it("issues one the director can read down a telephone, exactly once", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId, token } = await inviteFamily(staff, row.id as number);

    const res = await staff.agent
      .post(`/api/contacts/${contactId}/password`)
      .expect(200);

    const issued = String(res.body.password);
    expect(issued).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{2}$/);

    // It works, which is the point of handing it over.
    await asFamily(token)
      .put("/api/family/password")
      .send({ password: "chosen-by-the-family-9", currentPassword: issued })
      .expect(204);

    // And only the hash was kept, so nothing can hand it out again.
    const [stored] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, contactId));

    expect(stored!.passwordHash).not.toContain(issued);
  });

  it("never puts the hash on the wire", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { contactId, token } = await inviteFamily(staff, row.id as number);

    await asFamily(token).put("/api/family/password").send({ password: "willow-harbour-41" }).expect(204);

    const res = await staff.agent.get(`/api/cases/${row.id}/contacts`).expect(200);
    const contact = res.body.find((c: { id: number }) => c.id === contactId);

    expect(contact).not.toHaveProperty("passwordHash");
    expect(contact).not.toHaveProperty("tokenHash");
    expect(contact.hasPassword).toBe(true);
  });
});

describe("authorizing takes more than holding the link", () => {
  it("needs the level, the determination, and a password — all three", async () => {
    const base = {
      accessLevel: "authorizing",
      dispositionTier: "surviving_spouse",
      authorityRecordedAt: new Date(),
      passwordHash: "scrypt$...",
    };

    expect(canAuthorize(base)).toBe(true);

    // Each one on its own is enough to stop it.
    expect(canAuthorize({ ...base, accessLevel: "arranging" })).toBe(false);
    expect(canAuthorize({ ...base, dispositionTier: null })).toBe(false);
    expect(canAuthorize({ ...base, authorityRecordedAt: null })).toBe(false);
    expect(canAuthorize({ ...base, passwordHash: null })).toBe(false);
  });
});

describe("a contested disposition stops the signing", () => {
  it("is off by default and can be set and lifted", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    expect(row.dispositionDisputed).toBe(false);

    const disputed = await staff.agent
      .put(`/api/cases/${row.id}/disposition-dispute`)
      .send({ disputed: true, note: "Two daughters, no agreement." })
      .expect(200);

    expect(disputed.body.dispositionDisputed).toBe(true);

    const settled = await staff.agent
      .put(`/api/cases/${row.id}/disposition-dispute`)
      .send({ disputed: false })
      .expect(200);

    expect(settled.body.dispositionDisputed).toBe(false);
  });

  it("is another home's business and nobody else's", async () => {
    const mine = await signUpHome("Horan & McConaty");
    const theirs = await signUpHome("Olinger");
    const row = await createCase(mine);

    await theirs.agent
      .put(`/api/cases/${row.id}/disposition-dispute`)
      .send({ disputed: true })
      .expect(404);
  });
});
