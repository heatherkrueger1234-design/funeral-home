/**
 * Who is holding the phone, on a plan.
 *
 * A pre-need file's kind says the person is alive; it cannot say whether the
 * person reading is them or their daughter. `isSubject` says which, and it is
 * what keeps "your plan" for the planner. It also outlives the plan: once the
 * file is at-need the planner has died, and these tests hold the line that
 * nobody then texts, links, or sends a grief check-in to the dead person's
 * own phone.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";
import { db, funeralHomesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DAY = 24 * 60 * 60 * 1000;

async function slugOf(homeId: number): Promise<string> {
  const [home] = await db
    .select({ slug: funeralHomesTable.slug })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homeId))
    .limit(1);
  return home!.slug;
}

async function contactsOf(
  staff: Awaited<ReturnType<typeof signUpHome>>,
  caseId: number,
): Promise<Array<Record<string, unknown>>> {
  const res = await staff.agent.get(`/api/cases/${caseId}/contacts`).expect(200);
  return res.body;
}

describe("a plan knows which contact is the planner", () => {
  it("marks the person who asked for a plan as the person it is for", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app)
      .post("/api/public/intake")
      .send({
        homeSlug: slug,
        kind: "pre_need",
        requesterName: "Harold Finch",
        requesterEmail: "harold@example.com",
        subjectFirstName: "Harold",
        subjectLastName: "Finch",
      })
      .expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const plan = await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/accept`)
      .expect(201);

    const [harold] = await contactsOf(staff, plan.body.id);
    expect(harold!.name).toBe("Harold Finch");
    expect(harold!.isSubject).toBe(true);
  });

  it("does not mark anybody on an at-need request", async () => {
    const staff = await signUpHome();
    const slug = await slugOf(staff.homeId);
    await request(app)
      .post("/api/public/intake")
      .send({
        homeSlug: slug,
        kind: "at_need",
        requesterName: "Marie Vance",
        requesterPhone: "+15555550142",
        relationship: "Daughter",
        subjectFirstName: "Eleanor",
        subjectLastName: "Vance",
      })
      .expect(202);

    const queue = await staff.agent.get("/api/intake-requests").expect(200);
    const opened = await staff.agent
      .post(`/api/intake-requests/${queue.body[0].id}/accept`)
      .expect(201);

    const [marie] = await contactsOf(staff, opened.body.id);
    expect(marie!.isSubject).toBe(false);
  });

  it("tells the portal whether the reader is the planner or their family", async () => {
    const staff = await signUpHome();
    const plan = await createCase(staff, { kind: "pre_need" });

    const planner = await inviteFamily(staff, plan.id, {
      name: "Margaret Hale",
      isSubject: true,
    });
    const daughter = await inviteFamily(staff, plan.id, {
      name: "Anne Hale",
      relationship: "Daughter",
      role: "contributor",
    });

    const hers = await asFamily(planner.token).get("/api/family/session").expect(200);
    expect(hers.body.contact.isSubject).toBe(true);

    // The daughter is on her mother's plan, not her own.
    const anne = await asFamily(daughter.token).get("/api/family/session").expect(200);
    expect(anne.body.contact.isSubject).toBe(false);
    expect(anne.body.case.kind).toBe("pre_need");
  });

  it("refuses the mark on a file for somebody who has died", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const refused = await staff.agent
      .post(`/api/cases/${row.id}/contacts`)
      .send({ name: "Anne Hale", isSubject: true })
      .expect(409);
    expect(refused.body.error).toMatch(/only a plan/i);

    const { contactId } = await inviteFamily(staff, row.id);
    await staff.agent
      .put(`/api/contacts/${contactId}`)
      .send({ isSubject: true })
      .expect(409);

    // Taking it off is never refused.
    const cleared = await staff.agent
      .put(`/api/contacts/${contactId}`)
      .send({ isSubject: false })
      .expect(200);
    expect(cleared.body.isSubject).toBe(false);
  });

  it("moves the mark rather than giving a plan two planners", async () => {
    const staff = await signUpHome();
    const plan = await createCase(staff, { kind: "pre_need" });

    const first = await inviteFamily(staff, plan.id, {
      name: "Margaret Hale",
      isSubject: true,
    });
    const second = await inviteFamily(staff, plan.id, { name: "Peggy Hale" });

    // The director had the wrong one: "Peggy" is the name she goes by.
    await staff.agent
      .put(`/api/contacts/${second.contactId}`)
      .send({ isSubject: true })
      .expect(200);

    const contacts = await contactsOf(staff, plan.id);
    const marked = contacts.filter((c) => c.isSubject);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.id).toBe(second.contactId);

    // And adding a new contact as the planner moves it again.
    await inviteFamily(staff, plan.id, { name: "Margaret P. Hale", isSubject: true });
    const after = await contactsOf(staff, plan.id);
    expect(after.filter((c) => c.isSubject).map((c) => c.name)).toEqual([
      "Margaret P. Hale",
    ]);
    expect(after.find((c) => c.id === first.contactId)!.isSubject).toBe(false);
  });
});

describe("the day the planner dies", () => {
  async function planWithFamily() {
    const staff = await signUpHome();
    const plan = await createCase(staff, { kind: "pre_need" });
    const planner = await inviteFamily(staff, plan.id, {
      name: "Margaret Hale",
      email: "margaret@example.com",
      phone: "+15555550101",
      canInvite: true,
      isSubject: true,
    });
    const son = await inviteFamily(staff, plan.id, {
      name: "Tom Hale",
      relationship: "Son",
      email: "tom@example.com",
      role: "contributor",
    });
    return { staff, plan, planner, son };
  }

  it("closes the planner's own link, and only theirs", async () => {
    const { staff, plan, planner, son } = await planWithFamily();

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({ dateOfDeath: new Date().toISOString() })
      .expect(200);

    // Whoever has her phone now cannot post in the chat as her.
    await asFamily(planner.token).get("/api/family/session").expect(401);
    // Her son carries on exactly as before.
    await asFamily(son.token).get("/api/family/session").expect(200);

    const contacts = await contactsOf(staff, plan.id);
    const margaret = contacts.find((c) => c.id === planner.contactId)!;
    expect(margaret.revokedAt).not.toBeNull();
    // Still on the file, but nobody's next of kin and nobody's inviter.
    expect(margaret.role).toBe("contributor");
    expect(margaret.canInvite).toBe(false);
    expect(margaret.isSubject).toBe(true);
  });

  it("will not reopen her link from the console", async () => {
    const { staff, plan, planner } = await planWithFamily();

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({ dateOfDeath: new Date().toISOString() })
      .expect(200);

    const reissued = await staff.agent
      .post(`/api/contacts/${planner.contactId}/link`)
      .expect(409);
    expect(reissued.body.error).toMatch(/add them as themselves/i);

    await staff.agent
      .post(`/api/contacts/${planner.contactId}/send-link`)
      .send({ smsConsent: true })
      .expect(409);
  });

  it("still lets a planner's link be reissued while the plan is a plan", async () => {
    const { staff, planner } = await planWithFamily();

    const reissued = await staff.agent
      .post(`/api/contacts/${planner.contactId}/link`)
      .expect(200);
    const token = String(reissued.body.link).split("/f/")[1]!;
    await asFamily(token).get("/api/family/session").expect(200);
  });

  it("never enrols the person who died in grief check-ins about themselves", async () => {
    const { staff, plan, planner, son } = await planWithFamily();

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({
        dateOfDeath: new Date(Date.now() - 3 * DAY).toISOString(),
        serviceAt: new Date(Date.now() - DAY).toISOString(),
      })
      .expect(200);
    await staff.agent.post(`/api/cases/${plan.id}/close`).expect(200);

    const enrolled = await staff.agent
      .get(`/api/cases/${plan.id}/aftercare`)
      .expect(200);
    const who = enrolled.body.map((e: { contactId: number }) => e.contactId);
    expect(who).toContain(son.contactId);
    expect(who).not.toContain(planner.contactId);
  });
});
