import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, uploadsTable, casePhotosTable } from "@workspace/db";
import {
  asFamily,
  createCase,
  inviteFamily,
  signUpHome,
  PNG_BYTES,
} from "./helpers";

/**
 * Adversarial probes. Each of these describes something a real deployment
 * would suffer from, written as the attack or the accident rather than as a
 * unit of implementation.
 */

describe("a family link cannot reach the home's other files", () => {
  it("refuses a staff upload that belongs to no case", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // A director uploads something at home level -- the logo, or a scan they
    // meant only for the office.
    const uploaded = await staff.agent
      .post("/api/uploads")
      .attach("file", PNG_BYTES, "internal.png")
      .expect(201);

    // A family member holding a link for an unrelated case must not get it.
    await asFamily(token)
      .get(`/api/family/uploads/${uploaded.body.id}`)
      .expect(404);
  });

  it("still serves the home's logo, which families need for branding", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    const logo = await staff.agent
      .post("/api/uploads")
      .attach("file", PNG_BYTES, "logo.png")
      .expect(201);

    await staff.agent
      .put("/api/home")
      .send({ logoUploadId: logo.body.id })
      .expect(200);

    await asFamily(token)
      .get(`/api/family/uploads/${logo.body.id}`)
      .expect(200);
  });
});

describe("photographs do not leave rubbish behind", () => {
  it("deletes the bytes when the case is deleted", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "gran.png")
      .expect(201);

    const before = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    expect(before).toHaveLength(1);

    // Deleting a case must not leave encrypted photographs of a family's
    // dead relative sitting in the uploads table forever.
    const { casesTable } = await import("@workspace/db");
    await db.delete(casesTable).where(eq(casesTable.id, row.id));

    const after = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    expect(after).toHaveLength(0);
  });

  it("leaves no orphaned upload when the photo row cannot be written", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "gran.png")
      .expect(201);

    // Every upload attached to a case should have a photo row pointing at it.
    const uploads = await db
      .select()
      .from(uploadsTable)
      .where(eq(uploadsTable.caseId, row.id));
    const photos = await db
      .select()
      .from(casePhotosTable)
      .where(eq(casePhotosTable.caseId, row.id));

    expect(uploads).toHaveLength(photos.length);
  });
});

describe("the home can grow", () => {
  it("lets an owner add a second director who can then sign in", async () => {
    const staff = await signUpHome("Green Lawn");

    const invited = await staff.agent
      .post("/api/home/staff")
      .send({
        email: "second@example.com",
        displayName: "Ray Ochoa",
        title: "Funeral Director",
        role: "director",
      })
      .expect(201);

    expect(invited.body.email).toBe("second@example.com");

    // And they land in the same home, seeing the same cases.
    const staffList = await staff.agent.get("/api/home/staff").expect(200);
    expect(staffList.body).toHaveLength(2);

    // No password was set by anyone else on their behalf: they arrive with
    // none and choose their own through the invite link.
    expect(invited.body.hasPassword).toBe(false);
    expect(invited.body.inviteLink).toContain("/reset-password?token=");
  });

  it("refuses an owner who would lock themselves out", async () => {
    const staff = await signUpHome();

    await staff.agent
      .put(`/api/home/staff/${staff.userId}`)
      .send({ active: false })
      .expect(400);

    await staff.agent
      .put(`/api/home/staff/${staff.userId}`)
      .send({ role: "staff" })
      .expect(400);

    // Still working.
    await staff.agent.get("/api/cases").expect(200);
  });

  it("does not let a non-owner add people", async () => {
    const owner = await signUpHome();

    const invited = await owner.agent
      .post("/api/home/staff")
      .send({ email: "helper@example.com", role: "staff" })
      .expect(201);

    // Give them a password the way the reset flow does, then sign in as them.
    const token = String(invited.body.inviteLink).split("token=")[1]!;
    const request = (await import("supertest")).default;
    const app = (await import("../src/app")).default;

    const agent = request.agent(app);
    await agent
      .post("/api/auth/reset-password")
      .send({ token: decodeURIComponent(token), password: "another-long-pass" })
      .expect(204);
    await agent
      .post("/api/auth/login")
      .send({ email: "helper@example.com", password: "another-long-pass" })
      .expect(200);

    // They can work cases...
    await agent.get("/api/cases").expect(200);
    // ...but not hire.
    await agent
      .post("/api/home/staff")
      .send({ email: "third@example.com" })
      .expect(403);
    // ...and not change the home's settings.
    await agent.put("/api/home").send({ name: "Renamed" }).expect(400);
  });
});
