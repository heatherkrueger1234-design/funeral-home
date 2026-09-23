import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The standard schedule is the feature that decides whether the timeline ever
 * gets used at all, so the behaviour worth pinning is not "rows appear" — it
 * is what happens on the second press, and when a funeral moves.
 */
describe("the home's standard schedule", () => {
  it("gives a new home something usable without any setup", async () => {
    const staff = await signUpHome();
    const template = await staff.agent
      .get("/api/home/timeline-template")
      .expect(200);

    expect(template.body.length).toBeGreaterThan(0);
    expect(template.body.some((row: { isEvent: boolean }) => row.isEvent)).toBe(true);
    // Offsets are shown in words, because "-4320" is not a schedule.
    expect(template.body[0].offsetLabel).toMatch(/before|On the day/);
  });

  it("builds the case timeline the moment a service date is set", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    // Nothing yet: there is no date to measure from.
    const before = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);
    expect(before.body).toHaveLength(0);

    const serviceAt = new Date(Date.now() + 7 * DAY);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: serviceAt.toISOString() })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    expect(after.body.length).toBeGreaterThan(0);

    // The service lands exactly on the date, as an event nobody ticks off.
    const service = after.body.find((d: { isEvent: boolean }) => d.isEvent);
    expect(new Date(service.dueAt).getTime()).toBe(serviceAt.getTime());

    // And the rest fall before it.
    for (const entry of after.body.filter((d: { isEvent: boolean }) => !d.isEvent)) {
      expect(new Date(entry.dueAt).getTime()).toBeLessThan(serviceAt.getTime());
    }
  });

  it("does not duplicate anything when applied twice", async () => {
    const staff = await signUpHome();
    const serviceAt = new Date(Date.now() + 7 * DAY);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });

    const first = await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(200);
    const second = await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(200);

    expect(second.body).toHaveLength(first.body.length);
  });

  it("moves unfinished steps when the funeral moves, and leaves done ones alone", async () => {
    const staff = await signUpHome();
    const serviceAt = new Date(Date.now() + 7 * DAY);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });
    const { token } = await inviteFamily(staff, row.id);

    const initial = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    const task = initial.body.find((d: { isEvent: boolean }) => !d.isEvent);
    const originalDue = new Date(task.dueAt).getTime();

    // The family does one of them.
    await asFamily(token)
      .post(`/api/family/deadlines/${task.id}`)
      .send({ completed: true })
      .expect(200);

    // The funeral is pushed back three days.
    const moved = new Date(serviceAt.getTime() + 3 * DAY);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: moved.toISOString() })
      .expect(200);

    const rebuilt = await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(200);

    const service = rebuilt.body.find((d: { isEvent: boolean }) => d.isEvent);
    expect(new Date(service.dueAt).getTime()).toBe(moved.getTime());

    // The step the daughter already did keeps its original date. Telling her
    // that what she delivered on Tuesday is now due Thursday would be worse
    // than saying nothing.
    const done = rebuilt.body.find((d: { id: number }) => d.id === task.id);
    expect(done.completedAt).not.toBeNull();
    expect(new Date(done.dueAt).getTime()).toBe(originalDue);

    // An unfinished one moved with the funeral.
    const stillDue = rebuilt.body.find(
      (d: { isEvent: boolean; completedAt: string | null }) =>
        !d.isEvent && d.completedAt === null,
    );
    expect(new Date(stillDue.dueAt).getTime()).toBeGreaterThan(originalDue);
  });

  it("refuses to build a schedule with no date to measure from", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/deadlines/from-template`)
      .expect(400);
  });

  it("does not trample a timeline a director already built by hand", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    await staff.agent
      .post(`/api/cases/${row.id}/deadlines`)
      .send({ title: "Collect the ashes", dueAt: new Date(Date.now() + DAY).toISOString() })
      .expect(201);

    // Setting the date now must not auto-build over their work.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: new Date(Date.now() + 7 * DAY).toISOString() })
      .expect(200);

    const after = await staff.agent
      .get(`/api/cases/${row.id}/deadlines`)
      .expect(200);

    expect(after.body).toHaveLength(1);
    expect(after.body[0].title).toBe("Collect the ashes");
  });
});
