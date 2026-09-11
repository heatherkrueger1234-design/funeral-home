import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env["TASK_SECRET"];
});

/**
 * The scheduled trigger. For most of this product's life the aftercare sent
 * nothing in production because it was a script nobody ran, so the thing
 * worth pinning is that something can actually fire it — and that what fires
 * it has to prove who it is.
 */
describe("the aftercare trigger", () => {
  it("refuses entirely when no secret is configured", async () => {
    // An unauthenticated endpoint that sends email to bereaved families is
    // not something to leave open because an env var is missing.
    await request(app)
      .post("/api/tasks/aftercare")
      .set("Authorization", "Bearer anything")
      .expect(503);
  });

  it("refuses a wrong secret, and a missing one", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    await request(app).post("/api/tasks/aftercare").expect(401);
    await request(app)
      .post("/api/tasks/aftercare")
      .set("Authorization", "Bearer not-it")
      .expect(401);
    // Length differences must not be a timing signal either.
    await request(app)
      .post("/api/tasks/aftercare")
      .set("Authorization", "Bearer short")
      .expect(401);
  });

  it("reports what is due without sending, on a dry run", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    const staff = await signUpHome();
    const row = await createCase(staff, {
      // A service long enough ago that the 30-day check-in is overdue.
      serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const dry = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);

    expect(dry.body.due).toBe(1);
    expect(dry.body.sent).toBe(0);
    expect(dry.body.dryRun).toBe(true);

    // And nothing was marked, so the real run still has it to do.
    const again = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);
    expect(again.body.due).toBe(1);
  });

  it("does not send to a family who never consented", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    await inviteFamily(staff, row.id, { email: "anne@example.com" });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    // Enrolment exists but is still pending.

    const dry = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);

    expect(dry.body.due).toBe(0);
  });

  it("stops sending the moment a family unsubscribes", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 40 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const before = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);
    expect(before.body.due).toBe(1);

    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: false })
      .expect(200);

    // Consent is checked when the message would go out, not when it was
    // scheduled — so something queued a month ago stops immediately.
    const after = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);
    expect(after.body.due).toBe(0);
  });
});
