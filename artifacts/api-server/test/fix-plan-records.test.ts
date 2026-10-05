/**
 * The one-off repair for plans saved before 5 October
 * (`scripts/src/fix-plan-records.ts`), run against plans left in each state
 * the old code could leave them in. Each scenario first undoes what today's
 * code does on its own, so the database looks the way an old one does.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";
import {
  aftercareEnrollmentsTable,
  db,
  familyContactsTable,
  funeralHomesTable,
  vitalStatisticsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { fixPlanRecords } from "../../../scripts/src/lib/plan-records";

const DAY = 24 * 60 * 60 * 1000;

/** A plan accepted from the public form, as the old code left it. */
async function oldPlanFromTheForm() {
  const staff = await signUpHome();
  const [home] = await db
    .select({ slug: funeralHomesTable.slug })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, staff.homeId));
  await request(app)
    .post("/api/public/intake")
    .send({
      homeSlug: home!.slug,
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

  // Before 5 October there was no flag to set.
  const [harold] = await db
    .update(familyContactsTable)
    .set({ isSubject: false })
    .where(eq(familyContactsTable.caseId, plan.body.id))
    .returning();

  // And before 4 October his own page named him as his informant.
  await staff.agent
    .put(`/api/cases/${plan.body.id}/vitals`)
    .send({ informantName: "Harold Finch", informantPhone: "+15555550111" })
    .expect(200);

  return { staff, caseId: plan.body.id as number, harold: harold! };
}

async function informantOf(caseId: number) {
  const [row] = await db
    .select()
    .from(vitalStatisticsTable)
    .where(eq(vitalStatisticsTable.caseId, caseId));
  return row?.informantName ?? null;
}

describe("repairing plans saved before 5 October", () => {
  it("only reports on a dry run, and writes nothing", async () => {
    const { caseId, harold } = await oldPlanFromTheForm();

    const { changes } = await fixPlanRecords({ apply: false });

    expect(changes.map((c) => c.what)).toEqual([
      `contact ${harold.id} marked as the person the plan is for`,
      expect.stringMatching(/the planner removed as their own informant/),
    ]);
    const [still] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, harold.id));
    expect(still!.isSubject).toBe(false);
    expect(await informantOf(caseId)).toBe("Harold Finch");
  });

  it("marks the planner and takes them off their own certificate", async () => {
    const { caseId, harold } = await oldPlanFromTheForm();

    await fixPlanRecords({ apply: true });

    const [marked] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, harold.id));
    expect(marked!.isSubject).toBe(true);
    expect(await informantOf(caseId)).toBeNull();

    // And a second run has nothing left to do.
    const again = await fixPlanRecords({ apply: true });
    expect(again.changes).toEqual([]);
  });

  it("closes a dead planner's link and stops their grief check-ins", async () => {
    const { staff, caseId, harold } = await oldPlanFromTheForm();

    // The old conversion: nothing marked him, so nothing closed his link,
    // and closing the case enrolled him at his own address.
    await staff.agent
      .post(`/api/cases/${caseId}/at-need`)
      .send({
        dateOfDeath: new Date(Date.now() - 3 * DAY).toISOString(),
        serviceAt: new Date(Date.now() - DAY).toISOString(),
      })
      .expect(200);
    await staff.agent.post(`/api/cases/${caseId}/close`).expect(200);
    const [enrolled] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.contactId, harold.id));
    expect(enrolled).toBeDefined();

    const { changes } = await fixPlanRecords({ apply: true });
    expect(changes.map((c) => c.what)).toContain(
      `aftercare enrolment ${enrolled!.id} for the person who died: stopped`,
    );

    const [after] = await db
      .select()
      .from(familyContactsTable)
      .where(eq(familyContactsTable.id, harold.id));
    expect(after!.isSubject).toBe(true);
    expect(after!.revokedAt).not.toBeNull();
    expect(after!.role).toBe("contributor");
    expect(after!.canInvite).toBe(false);

    const [stopped] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrolled!.id));
    expect(stopped!.unsubscribedAt).not.toBeNull();
  });

  it("lists, and never changes, what it cannot be sure of", async () => {
    // A plan a director opened by hand: nothing says which contact is the
    // planner.
    const staff = await signUpHome();
    const byHand = await createCase(staff, { kind: "pre_need" });
    await inviteFamily(staff, byHand.id, { name: "Margaret Hale" });

    // An at-need file whose informant shares the name of the man who died:
    // usually a slip, sometimes his son.
    const ordinary = await createCase(staff, {
      decedentFirstName: "John",
      decedentLastName: "Ames",
    });
    await staff.agent
      .put(`/api/cases/${ordinary.id}/vitals`)
      .send({ informantName: "John Ames" })
      .expect(200);

    const { changes, review } = await fixPlanRecords({ apply: true });

    expect(changes).toEqual([]);
    expect(review.map((r) => r.caseId).sort()).toEqual([byHand.id, ordinary.id].sort());
    expect(await informantOf(ordinary.id)).toBe("John Ames");
  });
});

describe("a plan becoming a case, today", () => {
  it("takes the planner off the certificate as the informant", async () => {
    const staff = await signUpHome();
    const plan = await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      decedentPreferredName: "Peggy",
    });
    const planner = await inviteFamily(staff, plan.id, {
      name: "Peggy Hale",
      isSubject: true,
    });
    const son = await inviteFamily(staff, plan.id, { name: "Tom Hale", role: "contributor" });
    await staff.agent
      .put(`/api/cases/${plan.id}/vitals`)
      .send({ informantName: "peggy  hale", informantRelationship: "Self" })
      .expect(200);

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({ dateOfDeath: new Date().toISOString() })
      .expect(200);

    expect(await informantOf(plan.id)).toBeNull();
    // The family's page now offers the son his own details instead.
    const vitals = await asFamily(son.token).get("/api/family/vitals").expect(200);
    expect(vitals.body.informantName).toBeNull();
    await asFamily(planner.token).get("/api/family/session").expect(401);
  });

  it("leaves a real informant alone", async () => {
    const staff = await signUpHome();
    const plan = await createCase(staff, { kind: "pre_need" });
    await inviteFamily(staff, plan.id, { name: "Margaret Hale", isSubject: true });
    await staff.agent
      .put(`/api/cases/${plan.id}/vitals`)
      .send({ informantName: "Anne Hale" })
      .expect(200);

    await staff.agent
      .post(`/api/cases/${plan.id}/at-need`)
      .send({ dateOfDeath: new Date().toISOString() })
      .expect(200);

    expect(await informantOf(plan.id)).toBe("Anne Hale");
  });
});
