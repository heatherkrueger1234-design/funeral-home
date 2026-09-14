import { describe, expect, it } from "vitest";
import { signUpHome, createCase, inviteFamily, asFamily } from "./helpers";

/**
 * The way this software can tell a family the wrong day for a funeral.
 *
 * It is not exotic and it does not show up as an error: the service moves.
 * The case record said Monday, the family's timeline still said Friday, and
 * two screens of the same app disagreed about when somebody's mother was
 * being buried — with nothing anywhere saying they had drifted.
 */

const FRIDAY = "2026-06-12T16:00:00.000Z"; // 10am Friday in Denver
const MONDAY = "2026-06-15T16:00:00.000Z"; // 10am Monday in Denver

describe("when the service moves", () => {
  it("carries the family's timeline with it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: FRIDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const before = await asFamily(token)
      .get("/api/family/deadlines")
      .expect(200);
    const clothingBefore = before.body.find((d: { title: string }) =>
      d.title.startsWith("Bring clothing"),
    );

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: MONDAY })
      .expect(200);

    const after = await asFamily(token)
      .get("/api/family/deadlines")
      .expect(200);

    // The service itself is the one the family reads off the top of the page.
    expect(after.body.find((d: { isEvent: boolean }) => d.isEvent).dueAt).toBe(
      MONDAY,
    );

    // And everything measured from it moves by the same three days.
    const clothingAfter = after.body.find((d: { title: string }) =>
      d.title.startsWith("Bring clothing"),
    );
    expect(
      Date.parse(clothingAfter.dueAt) - Date.parse(clothingBefore.dueAt),
    ).toBe(Date.parse(MONDAY) - Date.parse(FRIDAY));
  });

  it("leaves a step the family has already done exactly where it was", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: FRIDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const before = await asFamily(token)
      .get("/api/family/deadlines")
      .expect(200);
    const clothing = before.body.find((d: { title: string }) =>
      d.title.startsWith("Bring clothing"),
    );

    await asFamily(token)
      .post(`/api/family/deadlines/${clothing.id}`)
      .send({ completed: true })
      .expect(200);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: MONDAY })
      .expect(200);

    const after = await asFamily(token)
      .get("/api/family/deadlines")
      .expect(200);
    const clothingAfter = after.body.find(
      (d: { id: number }) => d.id === clothing.id,
    );

    expect(clothingAfter.dueAt).toBe(clothing.dueAt);
    expect(clothingAfter.completedAt).not.toBeNull();
  });

  it("does nothing when the date is written again unchanged", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: FRIDAY });

    const before = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: FRIDAY, serviceLocation: "St Anne's" })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    expect(after.body.map((d: { dueAt: string }) => d.dueAt)).toEqual(
      before.body.map((d: { dueAt: string }) => d.dueAt),
    );
  });

  it("builds a timeline on a case that never had one, when the date arrives", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    expect(
      (await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200))
        .body,
    ).toHaveLength(0);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: FRIDAY })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    expect(after.body.length).toBeGreaterThan(0);
  });
});
