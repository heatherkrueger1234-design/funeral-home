import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

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

    const thirty = session.body.aftercare.deliveries[0];
    expect(new Date(thirty.dueAt).getTime()).toBe(
      serviceAt.getTime() + 30 * DAY,
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
});
