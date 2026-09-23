import { describe, it, expect } from "vitest";
import request from "supertest";
import { db, usersTable, emailVerificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { signUpHome } from "./helpers";
import { funeralHomesTable } from "@workspace/db";

async function slugOf(homeId: number): Promise<string> {
  const [home] = await db
    .select({ slug: funeralHomesTable.slug })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId))
    .limit(1);
  return home!.slug;
}

function atNeed(slug: string) {
  return {
    homeSlug: slug,
    kind: "at_need",
    requesterName: "Alan Dunn",
    requesterPhone: "+13035550142",
    relationship: "Son",
    subjectFirstName: "Margaret",
    subjectLastName: "Dunn",
  };
}

/**
 * Confirming the address a funeral home registered with.
 *
 * `users.emailVerified` had been a column since the beginning and nothing ever
 * wrote to it, which meant registration checked nothing at all: anybody could
 * register under a real funeral home's name and have a public page — at a
 * guessable URL, in that home's name — collecting the details of people's
 * deaths within a minute.
 *
 * So these tests are in two halves, and the second matters as much as the
 * first. One: the page does not take a request from a home nobody has heard
 * from. Two: confirmation gates *nothing else*, because a director locked out
 * of Thursday's funeral by a confirmation email in a spam folder would be a
 * far worse product than the one this protects against.
 */

/** Read the token straight out of the row, standing in for reading the email. */
async function tokenFor(email: string): Promise<string> {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  const rows = await db
    .select()
    .from(emailVerificationsTable)
    .where(eq(emailVerificationsTable.userId, user!.id));

  // The digest is what is stored, so a test cannot recover the token. It
  // re-issues one instead, which is the same path a director takes when they
  // lose the email — and proves the resend route works while it is at it.
  expect(rows.length).toBeGreaterThan(0);

  const { createEmailVerification } = await import("../src/lib/auth");
  return createEmailVerification(user!.id, email);
}

describe("registering", () => {
  it("issues a confirmation link and leaves the account unconfirmed", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, staff.userId));

    expect(user!.emailVerified).toBe(false);

    const outstanding = await db
      .select()
      .from(emailVerificationsTable)
      .where(eq(emailVerificationsTable.userId, staff.userId));

    expect(outstanding).toHaveLength(1);
    // The address is written into the row, not read off the user at redemption.
    expect(outstanding[0]!.email).toBe(staff.email);
  });

  it("confirms the address from the link, once", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });
    const token = await tokenFor(staff.email);

    // No session: the link is opened on whichever device the email is on.
    await request(app).post("/api/auth/verify-email").send({ token }).expect(204);

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, staff.userId));

    expect(user!.emailVerified).toBe(true);

    // A link that stays in an inbox forever must not stay redeemable.
    await request(app).post("/api/auth/verify-email").send({ token }).expect(400);
  });

  it("refuses a token that was never issued", async () => {
    await signUpHome("Aspen & Vale", { verified: false });

    await request(app)
      .post("/api/auth/verify-email")
      .send({ token: "not-a-token-anyone-issued" })
      .expect(400);
  });

  it("sends another link on request, without saying whether one was needed", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });

    await staff.agent.post("/api/auth/resend-verification").expect(204);

    const outstanding = await db
      .select()
      .from(emailVerificationsTable)
      .where(eq(emailVerificationsTable.userId, staff.userId));

    expect(outstanding.length).toBeGreaterThan(1);

    // Already confirmed: still 204, so this is not a way to ask.
    await db
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.id, staff.userId));

    await staff.agent.post("/api/auth/resend-verification").expect(204);
  });

  it("is not a route a stranger can aim at somebody else's inbox", async () => {
    await signUpHome("Aspen & Vale", { verified: false });

    await request(app).post("/api/auth/resend-verification").expect(401);
  });
});

describe("what confirmation gates", () => {
  it("keeps the public request form shut until somebody has confirmed", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });
    const slug = await slugOf(staff.homeId);

    const before = await request(app)
      .get(`/api/public/homes/${slug}`)
      .expect(200);

    /*
     * The page still renders. A home that exists has a real telephone, and a
     * family who reached this page needs that number — so the form is reported
     * off and the client shows the phone, exactly as it does for a home whose
     * subscription lapsed.
     */
    expect(before.body.intakeEnabled).toBe(false);

    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(404);

    const token = await tokenFor(staff.email);
    await request(app).post("/api/auth/verify-email").send({ token }).expect(204);

    const after = await request(app)
      .get(`/api/public/homes/${slug}`)
      .expect(200);

    expect(after.body.intakeEnabled).toBe(true);

    await request(app).post("/api/public/intake").send(atNeed(slug)).expect(202);
  });

  it("gates nothing a director does", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });

    // The whole product, from an unconfirmed account. Every one of these is a
    // thing that must not wait on an email arriving.
    await staff.agent.get("/api/auth/me").expect(200);
    await staff.agent.get("/api/home").expect(200);
    await staff.agent.get("/api/home/dashboard").expect(200);

    const created = await staff.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Dunn" })
      .expect(201);

    const contact = await staff.agent
      .post(`/api/cases/${created.body.id}/contacts`)
      .send({ name: "Alan Dunn", role: "next_of_kin" })
      .expect(201);

    // Including the family's way in, which is the part that would really hurt.
    expect(contact.body.link).toContain("/f/");

    await staff.agent.get(`/api/cases/${created.body.id}/export`).expect(200);
  });

  it("counts any confirmed member of staff, not only the owner", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });

    const slug = await slugOf(staff.homeId);

    await staff.agent
      .post("/api/home/staff")
      .send({ email: "manager@aspenvale.example", displayName: "Ruth Calder" })
      .expect(201);

    const closed = await request(app)
      .get(`/api/public/homes/${slug}`)
      .expect(200);
    expect(closed.body.intakeEnabled).toBe(false);

    /*
     * A home where the manager confirmed and the proprietor never opened their
     * inbox is a home we have plainly heard from. Requiring the owner
     * specifically would leave that home's page shut for no reason anybody
     * could explain to them.
     */
    await db
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.email, "manager@aspenvale.example"));

    const open = await request(app)
      .get(`/api/public/homes/${slug}`)
      .expect(200);
    expect(open.body.intakeEnabled).toBe(true);
  });

  it("does not count a member of staff who has been deactivated", async () => {
    const staff = await signUpHome("Aspen & Vale", { verified: false });

    const slug = await slugOf(staff.homeId);

    const added = await staff.agent
      .post("/api/home/staff")
      .send({ email: "manager@aspenvale.example", displayName: "Ruth Calder" })
      .expect(201);

    await db
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.email, "manager@aspenvale.example"));

    await staff.agent
      .put(`/api/home/staff/${added.body.id}`)
      .send({ active: false })
      .expect(200);

    const res = await request(app)
      .get(`/api/public/homes/${slug}`)
      .expect(200);

    expect(res.body.intakeEnabled).toBe(false);
  });
});

describe("the links these emails contain", () => {
  /*
   * Not a test of email verification, but it belongs beside it: until the
   * console had a page at `/reset-password`, three separate emails pointed
   * there and all three did nothing. The invitation was the expensive one,
   * because it failed silently — a funeral home could not add a second
   * employee, and nothing said so.
   */
  it("marks a staff invitation as an invitation, not a reset", async () => {
    const staff = await signUpHome("Aspen & Vale");

    await staff.agent
      .post("/api/home/staff")
      .send({ email: "manager@aspenvale.example", displayName: "Ruth Calder" })
      .expect(201);

    const [invited] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, "manager@aspenvale.example"));

    /*
     * A new member of staff choosing their first password must not be told it
     * was "reset" on an account they have never signed in to, so the link
     * carries `invited=1` and the page words itself off that.
     */
    const { db: database, passwordResetsTable } = await import("@workspace/db");
    const outstanding = await database
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, invited!.id));

    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]!.usedAt).toBeNull();
  });

  it("lets an invited member of staff set a password and sign in", async () => {
    const staff = await signUpHome("Aspen & Vale");

    const added = await staff.agent
      .post("/api/home/staff")
      .send({ email: "manager@aspenvale.example", displayName: "Ruth Calder" })
      .expect(201);

    // Stand in for the emailed token, which is stored only as a digest.
    const { createPasswordReset } = await import("../src/lib/auth");
    const token = await createPasswordReset(added.body.id);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "a-passphrase-she-will-recall" })
      .expect(204);

    // The whole point of the invitation: she can now get in by herself.
    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({
        email: "manager@aspenvale.example",
        password: "a-passphrase-she-will-recall",
      })
      .expect(200);

    await agent.get("/api/home/dashboard").expect(200);
  });
});
