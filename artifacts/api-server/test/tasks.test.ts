import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  aftercareDeliveriesTable,
  aftercareEnrollmentsTable,
} from "@workspace/db";
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

  it("retries a delivery that failed instead of dropping it for good", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 400 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const [enrollment] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.caseId, row.id));

    // Simulate the 30-day check-in having failed on a previous run — an
    // SMTP hiccup, say — while the other three offsets are still ahead of it
    // and have never been attempted.
    await db
      .update(aftercareDeliveriesTable)
      .set({ failedAt: new Date(Date.now() - DAY), failureReason: "SMTP timeout" })
      .where(
        and(
          eq(aftercareDeliveriesTable.enrollmentId, enrollment!.id),
          eq(aftercareDeliveriesTable.dayOffset, 30),
        ),
      );

    // It must still be reported as due, not silently excluded because a
    // `failedAt` is already on the row.
    const dry = await request(app)
      .post("/api/tasks/aftercare?dryRun=1")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);
    expect(dry.body.due).toBe(4);
  });

  it("does not mark an enrolment done while a failed delivery is still unresolved", async () => {
    process.env["TASK_SECRET"] = "a-real-secret-value";

    const staff = await signUpHome();
    const row = await createCase(staff, {
      serviceAt: new Date(Date.now() - 400 * DAY).toISOString(),
    });
    const { token } = await inviteFamily(staff, row.id, {
      email: "anne@example.com",
    });

    await staff.agent.post(`/api/cases/${row.id}/close`).expect(200);
    await asFamily(token)
      .post("/api/family/aftercare")
      .send({ consent: true })
      .expect(200);

    const [enrollment] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.caseId, row.id));

    // Three of the four check-ins already went out on an earlier run; the
    // fourth failed and was never retried. This is the exact state a
    // permanently-dropped delivery leaves behind.
    await db
      .update(aftercareDeliveriesTable)
      .set({ sentAt: new Date(Date.now() - DAY) })
      .where(
        and(
          eq(aftercareDeliveriesTable.enrollmentId, enrollment!.id),
          eq(aftercareDeliveriesTable.dayOffset, 30),
        ),
      );
    await db
      .update(aftercareDeliveriesTable)
      .set({ sentAt: new Date(Date.now() - DAY) })
      .where(
        and(
          eq(aftercareDeliveriesTable.enrollmentId, enrollment!.id),
          eq(aftercareDeliveriesTable.dayOffset, 60),
        ),
      );
    await db
      .update(aftercareDeliveriesTable)
      .set({ sentAt: new Date(Date.now() - DAY) })
      .where(
        and(
          eq(aftercareDeliveriesTable.enrollmentId, enrollment!.id),
          eq(aftercareDeliveriesTable.dayOffset, 90),
        ),
      );
    await db
      .update(aftercareDeliveriesTable)
      .set({ failedAt: new Date(Date.now() - DAY), failureReason: "SMTP timeout" })
      .where(
        and(
          eq(aftercareDeliveriesTable.enrollmentId, enrollment!.id),
          eq(aftercareDeliveriesTable.dayOffset, 365),
        ),
      );

    // No SMTP is configured in this test run, so the real (non-dry) run
    // cannot actually send the still-outstanding one either — it can only
    // be marked skipped. What matters is whether the enrolment is
    // considered finished afterwards.
    await request(app)
      .post("/api/tasks/aftercare")
      .set("Authorization", "Bearer a-real-secret-value")
      .expect(200);

    const [after] = await db
      .select()
      .from(aftercareEnrollmentsTable)
      .where(eq(aftercareEnrollmentsTable.id, enrollment!.id));
    expect(after!.status).toBe("active");
  });
});
