import { describe, expect, it } from "vitest";
import { signUpHome, createCase, inviteFamily, asFamily } from "./helpers";
import { renderPrintItem, resolveSlots } from "../src/lib/print-render";
import { findTemplate } from "../src/lib/print-templates";

/**
 * Two ways this software can tell a family the wrong time for a funeral.
 *
 * Neither is exotic and neither shows up as an error: the service moves, or
 * the server is not in the home's timezone. Both were live.
 */

const FRIDAY = "2026-06-12T16:00:00.000Z"; // 10am Friday in Denver
const MONDAY = "2026-06-15T16:00:00.000Z"; // 10am Monday in Denver

describe("when the service moves", () => {
  it("carries the family's timeline with it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { serviceAt: FRIDAY });
    const { token } = await inviteFamily(staff, row.id as number);

    const before = await asFamily(token).get("/api/family/deadlines").expect(200);
    const clothingBefore = before.body.find((d: { title: string }) =>
      d.title.startsWith("Bring clothing"),
    );

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: MONDAY })
      .expect(200);

    const after = await asFamily(token).get("/api/family/deadlines").expect(200);

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

    const before = await asFamily(token).get("/api/family/deadlines").expect(200);
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

    const after = await asFamily(token).get("/api/family/deadlines").expect(200);
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
});

describe("print, in the home's timezone", () => {
  const home = {
    name: "Horan & McConaty",
    accentColor: "#1f4e46",
    timezone: "America/Denver",
  } as never;

  const decedent = {
    decedentFirstName: "Margaret",
    decedentLastName: "Hale",
    dateOfBirth: null,
    // 6pm on New Year's Eve in Denver, which is already next year in UTC.
    dateOfDeath: new Date("2026-01-01T01:00:00Z"),
    serviceAt: new Date(FRIDAY),
    serviceLocation: "St Anne's",
  } as never;

  it("prints the service time the family will turn up at", () => {
    const html = renderPrintItem({
      template: findTemplate("program-folded")!,
      case: decedent,
      home,
      values: {},
      photoDataUri: null,
      logoDataUri: null,
    });

    expect(html).toContain("10:00 AM");
    expect(html).toContain("Friday");
    expect(html).not.toContain("4:00 PM");
  });

  it("prints the year they died in, not the server's", () => {
    const slots = resolveSlots({
      template: findTemplate("prayer-card")!,
      case: decedent,
      values: {},
      timezone: "America/Denver",
    });

    expect(slots["dates"]).toBe("2025");
  });

  it("falls back to UTC rather than failing a print run", () => {
    const slots = resolveSlots({
      template: findTemplate("program-folded")!,
      case: decedent,
      values: {},
      timezone: "Not/AZone",
    });

    expect(slots["serviceLine"]).toContain("4:00 PM");
  });
});
