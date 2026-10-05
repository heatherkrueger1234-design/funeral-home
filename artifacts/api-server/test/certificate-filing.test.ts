import { describe, expect, it } from "vitest";
import { asFamily, createCase, inviteFamily, signUpHome } from "./helpers";

/**
 * Colorado's 72-hour death certificate clock.
 *
 * Most of what is pinned here is about the clock starting from the right
 * fact and stopping at the right one: custody rather than the death, a
 * filing the director recorded rather than one we pretend to have made, and
 * nothing at all on a file for somebody who is alive.
 */

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);

describe("the death certificate clock", () => {
  it("starts nowhere until a director records custody", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const empty = await staff.agent
      .get(`/api/cases/${row.id}/certificate-filing`)
      .expect(200);

    // Nothing in the product may invent the moment a legal deadline is
    // measured from, so there is no due time to show yet.
    expect(empty.body.standing).toBe("no_custody");
    expect(empty.body.custodyTakenAt).toBeNull();
    expect(empty.body.dueAt).toBeNull();
    expect(empty.body.stateCode).toBe("CO");
    expect(empty.body.filingWindowHours).toBe(72);
  });

  it("is due 72 hours from custody, not from the death", async () => {
    const staff = await signUpHome();
    // Died on the Sunday, released by the coroner days later.
    const row = await createCase(staff, { dateOfDeath: "2026-09-20" });
    const custody = hoursAgo(10);

    const saved = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ custodyTakenAt: custody.toISOString() })
      .expect(200);

    expect(new Date(saved.body.dueAt).getTime()).toBe(
      custody.getTime() + 72 * HOUR,
    );
    expect(saved.body.standing).toBe("open");
  });

  it("says when the 72 hours have gone, and stops once it is filed", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    const late = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ custodyTakenAt: hoursAgo(80).toISOString() })
      .expect(200);
    expect(late.body.standing).toBe("past_due");

    const filedAt = hoursAgo(1);
    const filed = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ filedAt: filedAt.toISOString(), stateFileNumber: " 2026-004417 " })
      .expect(200);

    // Filed late is still filed; the console should stop pointing at it.
    expect(filed.body.standing).toBe("filed");
    expect(new Date(filed.body.filedAt).getTime()).toBe(filedAt.getTime());
    expect(filed.body.filedByName).toBe("Karen Voss");
    expect(filed.body.stateFileNumber).toBe("2026-004417");

    // Clearing it reopens the clock, and forgets who filed.
    const reopened = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ filedAt: null })
      .expect(200);
    expect(reopened.body.standing).toBe("past_due");
    expect(reopened.body.filedByName).toBeNull();
  });

  it("keeps the physician's own 72 hours separately", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const asked = hoursAgo(5);

    const saved = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({
        physicianRequestedAt: asked.toISOString(),
        certifyingPhysician: "  Dr. Lena Ortiz ",
      })
      .expect(200);

    expect(new Date(saved.body.physicianDueAt).getTime()).toBe(
      asked.getTime() + 72 * HOUR,
    );
    expect(saved.body.certifyingPhysician).toBe("Dr. Lena Ortiz");
    // The physician being asked does not start the home's own clock.
    expect(saved.body.standing).toBe("no_custody");
  });

  it("refuses a time in the future, because the deadline counts from it", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();

    for (const field of ["custodyTakenAt", "physicianRequestedAt", "filedAt"]) {
      await staff.agent
        .put(`/api/cases/${row.id}/certificate-filing`)
        .send({ [field]: tomorrow })
        .expect(400);
    }

    // A minute or two of clock drift between a laptop and the server is not
    // a mistyped date, and is allowed.
    await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ custodyTakenAt: new Date(Date.now() + 60_000).toISOString() })
      .expect(200);
  });

  it("has no clock for somebody planning their own funeral", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff, {
      kind: "pre_need",
      decedentFirstName: "Thomas",
      decedentLastName: "Brightwater",
    });

    const seen = await staff.agent
      .get(`/api/cases/${row.id}/certificate-filing`)
      .expect(200);
    expect(seen.body.standing).toBe("not_applicable");

    await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ custodyTakenAt: hoursAgo(1).toISOString() })
      .expect(409);
  });

  it("shows no deadline in a state whose statute nobody has checked", async () => {
    const staff = await signUpHome();
    await staff.agent.put("/api/home").send({ region: "Wyoming" }).expect(200);
    const row = await createCase(staff);

    const saved = await staff.agent
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ custodyTakenAt: hoursAgo(100).toISOString() })
      .expect(200);

    // Custody is still recorded, so the home keeps its own record...
    expect(saved.body.custodyTakenAt).not.toBeNull();
    // ...but a guessed deadline would be trusted, so there is none.
    expect(saved.body.filingWindowHours).toBeNull();
    expect(saved.body.dueAt).toBeNull();
    expect(saved.body.standing).toBe("open");
  });

  it("reads Colorado however the home typed it", async () => {
    for (const region of ["co", " Colorado ", "COLORADO"]) {
      const staff = await signUpHome();
      await staff.agent.put("/api/home").send({ region }).expect(200);
      const row = await createCase(staff);

      const seen = await staff.agent
        .get(`/api/cases/${row.id}/certificate-filing`)
        .expect(200);
      expect(seen.body.stateCode).toBe("CO");
      expect(seen.body.filingWindowHours).toBe(72);
    }
  });

  it("is never reachable with a family link", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id);

    // A widow does not need a timer, and this route is behind the staff
    // session gate whatever a family link carries.
    await asFamily(token)
      .get(`/api/cases/${row.id}/certificate-filing`)
      .expect(401);
    await asFamily(token)
      .put(`/api/cases/${row.id}/certificate-filing`)
      .send({ filedAt: new Date().toISOString() })
      .expect(401);
  });

  it("cannot be read or written across tenants", async () => {
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street");
    const theirCase = await createCase(theirs);

    await mine.agent
      .get(`/api/cases/${theirCase.id}/certificate-filing`)
      .expect(404);
    await mine.agent
      .put(`/api/cases/${theirCase.id}/certificate-filing`)
      .send({ custodyTakenAt: hoursAgo(1).toISOString() })
      .expect(404);

    const untouched = await theirs.agent
      .get(`/api/cases/${theirCase.id}/certificate-filing`)
      .expect(200);
    expect(untouched.body.custodyTakenAt).toBeNull();
  });
});

describe("certificates to file, on the master page", () => {
  it("lists the unfiled ones with custody recorded, soonest due first", async () => {
    const staff = await signUpHome();
    const other = await signUpHome("Elm Street");

    const earlier = await createCase(staff, { decedentLastName: "Earlier" });
    const later = await createCase(staff, { decedentLastName: "Later" });
    const filed = await createCase(staff, { decedentLastName: "Filed" });
    const noCustody = await createCase(staff, { decedentLastName: "Unrecorded" });
    const closed = await createCase(staff, { decedentLastName: "Closed" });
    const elsewhere = await createCase(other, { decedentLastName: "Elsewhere" });

    const record = (
      who: typeof staff,
      caseId: number,
      body: Record<string, unknown>,
    ) =>
      who.agent
        .put(`/api/cases/${caseId}/certificate-filing`)
        .send(body)
        .expect(200);

    await record(staff, later.id, { custodyTakenAt: hoursAgo(2).toISOString() });
    await record(staff, earlier.id, { custodyTakenAt: hoursAgo(30).toISOString() });
    await record(staff, filed.id, {
      custodyTakenAt: hoursAgo(50).toISOString(),
      filedAt: hoursAgo(1).toISOString(),
    });
    await record(staff, closed.id, { custodyTakenAt: hoursAgo(40).toISOString() });
    await staff.agent.post(`/api/cases/${closed.id}/close`).expect(200);
    await record(other, elsewhere.id, {
      custodyTakenAt: hoursAgo(60).toISOString(),
    });
    // Opened, never given a custody time: no clock to show.
    await staff.agent.get(`/api/cases/${noCustody.id}/certificate-filing`).expect(200);

    const dashboard = await staff.agent.get("/api/home/dashboard").expect(200);
    const rows = dashboard.body.certificatesToFile as Array<{
      caseId: number;
      custodyTakenAt: string;
      dueAt: string | null;
    }>;

    expect(rows.map((entry) => entry.caseId)).toEqual([earlier.id, later.id]);
    expect(
      new Date(rows[0]!.dueAt!).getTime() -
        new Date(rows[0]!.custodyTakenAt).getTime(),
    ).toBe(72 * HOUR);
  });
});
