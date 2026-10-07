import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";
import { checkInDueAt } from "../src/lib/aftercare";
import { calendarDayIn, localMorning } from "@workspace/db";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The aftercare loop, end to end. The failure this guards against is not a
 * crash: it is the feature being quietly unreachable, which is what it was --
 * the API accepted consent and no screen ever asked for it, so no check-in
 * could ever have been sent.
 */
describe("the aftercare loop closes", () => {
  it("offers the family a decision with real dates on it", async () => {
    const staff = await signUpHome("Horan & McConaty");
    const serviceAt = new Date(Date.now() - 2 * DAY);
    const row = await createCase(staff, { serviceAt: serviceAt.toISOString() });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const session = await asFamily(token).get("/api/family/session").expect(200);

    expect(session.body.aftercare).not.toBeNull();
    expect(session.body.aftercare.status).toBe("pending");

    // The family is consenting to something specific, so the dates have to be
    // there rather than an empty list.
    const offsets = session.body.aftercare.deliveries.map(
      (d: { dayOffset: number }) => d.dayOffset,
    );
    expect(offsets).toEqual([30, 60, 90, 365]);

    // Mid-morning where the home is, thirty days on from the service's own
    // day: the day the family was shown is the day it arrives.
    const thirty = new Date(session.body.aftercare.deliveries[0].dueAt);
    expect(thirty.getTime()).toBe(checkInDueAt(serviceAt, 30, "America/Denver").getTime());
    const there = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", ...options });
    expect(there({ hour: "numeric", hourCycle: "h23" }).format(thirty)).toBe("10");
    // Thirty calendar days on, in Denver, not thirty times 24 hours: the two
    // part company in the hour after midnight there when the clocks change
    // inside the month, which is how this went red on main every morning in
    // the run-up to the first Sunday of November.
    const serviceDay = calendarDayIn(serviceAt, "America/Denver");
    expect(there({ dateStyle: "short" }).format(thirty)).toBe(
      there({ dateStyle: "short" }).format(
        localMorning(serviceDay.year, serviceDay.month, serviceDay.day + 30, "America/Denver"),
      ),
    );
  });

  it("records a yes, and the director sees it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const seen = await staff.agent
      .get(`/api/cases/${row.id}/aftercare`)
      .expect(200);
    expect(seen.body[0].status).toBe("active");
    expect(seen.body[0].consentedAt).not.toBeNull();

    const session = await asFamily(token).get("/api/family/session").expect(200);
    expect(session.body.aftercare.status).toBe("active");
  });

  it("treats a no as final", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    const declined = await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: false })
      .expect(200);

    expect(declined.body.status).toBe("done");
    expect(declined.body.unsubscribedAt).not.toBeNull();

    // And the portal stops asking.
    const session = await asFamily(token).get("/api/family/session").expect(200);
    expect(session.body.aftercare.status).toBe("done");
  });

  it("refuses to re-enrol someone who already said no", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: false })
      .expect(200);

    // A replayed request, a stale tab, or a direct call against the family
    // token must not undo a decline — the UI hiding the option afterwards is
    // not the thing actually enforcing "no is final".
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(409);

    const session = await asFamily(token).get("/api/family/session").expect(200);
    expect(session.body.aftercare.status).toBe("done");
    expect(session.body.aftercare.unsubscribedAt).not.toBeNull();
  });
});

describe("a home stopping a family's check-ins", () => {
  it("stops them for good when somebody telephones and asks", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, { email: "anne@example.com" });
    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(200);

    const [enrollment] = (await staff.agent.get(`/api/cases/${row.id}/aftercare`).expect(200)).body;
    const stopped = await staff.agent
      .post(`/api/cases/${row.id}/aftercare/${enrollment.id}/stop`)
      .expect(200);
    expect(stopped.body[0].unsubscribedAt).not.toBeNull();
    expect(stopped.body[0].status).toBe("done");

    // Final: the family cannot say yes again behind it.
    await asFamily(token).post("/api/family/aftercare").send({ consent: true }).expect(409);

    // Stopping again changes nothing.
    const again = await staff.agent
      .post(`/api/cases/${row.id}/aftercare/${enrollment.id}/stop`)
      .expect(200);
    expect(again.body[0].unsubscribedAt).toBe(stopped.body[0].unsubscribedAt);
  });

  it("cannot stop another home's", async () => {
    const a = await signUpHome("Home A");
    const b = await signUpHome("Home B");
    const row = await createCase(a, { serviceAt: new Date(Date.now() - 2 * DAY).toISOString() });
    await inviteFamily(a, row.id, { email: "anne@example.com" });
    await a.agent.post(`/api/cases/${row.id}/close`).expect(200);
    const [enrollment] = (await a.agent.get(`/api/cases/${row.id}/aftercare`).expect(200)).body;

    await b.agent.post(`/api/cases/${row.id}/aftercare/${enrollment.id}/stop`).expect(404);
    const still = (await a.agent.get(`/api/cases/${row.id}/aftercare`).expect(200)).body;
    expect(still[0].unsubscribedAt).toBeNull();
  });
});
