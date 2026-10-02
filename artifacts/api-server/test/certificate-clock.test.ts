import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/** Colorado's 72-hour death-certificate clock (SB 23-020). */
describe("the 72-hour certificate clock", () => {
  it("does not start until custody is recorded, and always says who files", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const res = await staff.agent.get(`/api/cases/${row.id}/certificate`).expect(200);
    expect(res.body.dueAt).toBeNull();
    expect(res.body.hoursRemaining).toBeNull();
    expect(res.body.filingNotice).toMatch(/We do not file this/);
  });

  it("runs 72 hours from custody, shows on the dashboard, and stops when filed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, { decedentPreferredName: "Peggy" });
    const custody = new Date(Date.now() - 10 * 3_600_000);

    const res = await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({
        custodyTakenAt: custody.toISOString(),
        edrsRequestedAt: custody.toISOString(),
        certifyingProvider: "Dr Lee",
      })
      .expect(200);
    expect(new Date(res.body.dueAt).getTime()).toBe(custody.getTime() + 72 * 3_600_000);
    expect(res.body.hoursRemaining).toBeCloseTo(62, 0);
    expect(res.body.certificationDueAt).toBe(res.body.dueAt);

    const dashboard = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(dashboard.body.certificatesDue).toHaveLength(1);
    expect(dashboard.body.certificatesDue[0]).toMatchObject({ caseId: row.id, decedentName: "Peggy Hale" });

    const filed = await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({ filed: true, stateFileNumber: "2026-012345" })
      .expect(200);
    expect(filed.body.filedAt).not.toBeNull();
    expect(filed.body.filedByName).toBe("Karen Voss");
    expect(filed.body.hoursRemaining).toBeNull();

    const after = await staff.agent.get("/api/home/dashboard").expect(200);
    expect(after.body.certificatesDue).toHaveLength(0);
  });

  it("says plainly when the clock has run out", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const res = await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({ custodyTakenAt: new Date(Date.now() - 80 * 3_600_000).toISOString() })
      .expect(200);
    expect(res.body.hoursRemaining).toBeLessThan(0);
  });

  it("is another home's business only to that home, and never the family's", async () => {
    const staff = await signUpHome();
    const other = await signUpHome("Mesa Verde");
    const row = await createCase(staff);
    await staff.agent
      .put(`/api/cases/${row.id}/certificate`)
      .send({ custodyTakenAt: new Date().toISOString() })
      .expect(200);

    await other.agent.get(`/api/cases/${row.id}/certificate`).expect(404);

    const { token } = await inviteFamily(staff, row.id);
    const session = await asFamily(token).get("/api/family/session").expect(200);
    expect(JSON.stringify(session.body)).not.toContain("custodyTakenAt");
    await asFamily(token).get(`/api/cases/${row.id}/certificate`).expect(401);
  });
});
