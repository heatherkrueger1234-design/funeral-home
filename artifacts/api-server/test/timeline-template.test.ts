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
    const service = template.body.filter(
      (row: { anchor: string }) => row.anchor === "service",
    );
    expect(service[0].offsetLabel).toMatch(/before|On the day/);
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

  it("moves the family's timeline when the home moves the funeral, without a rebuild", async () => {
    const staff = await signUpHome();
    const serviceAt = new Date(Date.now() + 7 * DAY);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });
    const { token } = await inviteFamily(staff, row.id);

    const initial = await asFamily(token).get("/api/family/deadlines").expect(200);
    const [done, open] = initial.body.filter((d: { isEvent: boolean }) => !d.isEvent);

    // A director nudges one step by hand, a day earlier than the template.
    const nudged = new Date(new Date(open.dueAt).getTime() - DAY);
    await staff.agent
      .put(`/api/deadlines/${open.id}`)
      .send({ dueAt: nudged.toISOString() })
      .expect(200);

    await asFamily(token)
      .post(`/api/family/deadlines/${done.id}`)
      .send({ completed: true })
      .expect(200);

    // The church moves it two days later. Nobody presses anything else.
    const moved = new Date(serviceAt.getTime() + 2 * DAY);
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: moved.toISOString() })
      .expect(200);

    const after = await asFamily(token).get("/api/family/deadlines").expect(200);
    const byId = new Map(after.body.map((d: { id: number }) => [d.id, d]));

    const service = after.body.find((d: { isEvent: boolean }) => d.isEvent);
    expect(new Date(service.dueAt).getTime()).toBe(moved.getTime());

    // The nudge survives: it moved by the same two days, not back to the
    // template's time.
    const stillOpen = byId.get(open.id) as { dueAt: string };
    expect(new Date(stillOpen.dueAt).getTime()).toBe(nudged.getTime() + 2 * DAY);

    // What the family already did stays where it was.
    const stillDone = byId.get(done.id) as { dueAt: string };
    expect(stillDone.dueAt).toBe(done.dueAt);
  });

  it("leaves a director's hand-typed steps where they put them when the funeral moves", async () => {
    const staff = await signUpHome();
    const serviceAt = new Date(Date.now() + 7 * DAY);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });

    const typed = await staff.agent
      .post(`/api/cases/${row.id}/deadlines`)
      .send({ title: "Collect the ashes", dueAt: new Date(Date.now() + 10 * DAY).toISOString() })
      .expect(201);

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: new Date(serviceAt.getTime() + DAY).toISOString() })
      .expect(200);

    const after = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);
    const ashes = after.body.find((d: { id: number }) => d.id === typed.body.id);
    expect(ashes.dueAt).toBe(typed.body.dueAt);
  });

  it("builds the death certificate step from a date of death alone, the next afternoon", async () => {
    const staff = await signUpHome();
    // As a date field sends it: midnight UTC on the day.
    const row = await createCase(staff, {
      dateOfBirth: "1941-03-02T00:00:00.000Z",
      dateOfDeath: "2026-09-20T00:00:00.000Z",
    });

    const timeline = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);

    // Only the step that counts from the death: there is no service yet.
    expect(timeline.body).toHaveLength(1);
    expect(timeline.body[0].title).toMatch(/death certificate/i);
    // Five in the afternoon in Denver the next day, not the evening before.
    expect(timeline.body[0].dueAt).toBe("2026-09-21T23:00:00.000Z");

    // Then the service is booked, and the rest arrives beside it.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ serviceAt: "2026-09-26T19:00:00.000Z" })
      .expect(200);

    const full = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);
    expect(full.body.length).toBeGreaterThan(1);
    expect(full.body.some((d: { isEvent: boolean }) => d.isEvent)).toBe(true);

    // A corrected date of death moves the certificate step with it.
    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ dateOfDeath: "2026-09-19T00:00:00.000Z" })
      .expect(200);

    const corrected = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);
    const certificate = corrected.body.find((d: { title: string }) =>
      /death certificate/i.test(d.title),
    );
    expect(certificate.dueAt).toBe("2026-09-20T23:00:00.000Z");
  });

  it("never builds a death step on a pre-need file", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { kind: "pre_need" });

    await staff.agent
      .put(`/api/cases/${row.id}`)
      .send({ dateOfDeath: "2026-09-20T00:00:00.000Z" })
      .expect(200);

    const timeline = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);
    expect(timeline.body).toHaveLength(0);
  });

  it("lets a home add its own steps counted from the death", async () => {
    const staff = await signUpHome();

    const added = await staff.agent
      .post("/api/home/timeline-template")
      .send({ title: "Choose burial or cremation", offsetMinutes: 2 * 24 * 60, anchor: "death" })
      .expect(201);
    expect(added.body.anchor).toBe("death");
    expect(added.body.offsetLabel).toBe("2 days after the death");

    const row = await createCase(staff, { dateOfDeath: "2026-09-20T00:00:00.000Z" });
    const timeline = await staff.agent.get(`/api/cases/${row.id}/deadlines`).expect(200);
    expect(timeline.body.map((d: { title: string }) => d.title)).toContain(
      "Choose burial or cremation",
    );
  });
});
