import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  funeralHomesTable,
  platformAdminsTable,
  platformAuditTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { bootstrapPlatformAdmins } from "../src/lib/platform-auth";
import { signUpHome } from "./helpers";

/**
 * Who at the vendor may look across the tenant boundary, and who is a customer.
 *
 * Two problems with `PLATFORM_ADMIN_EMAILS`, and both cost something real.
 * Granting or revoking access meant a redeploy, so in practice the list went
 * stale — the one thing an access list must not do. And an environment variable
 * leaves no trace, so "who could see our families' files last March" had no
 * answer, which is a question a funeral home's insurer asks.
 *
 * The third thing here is smaller and more embarrassing. A platform admin needs
 * a staff account, a staff account needs a `funeral_homes` row, and that row sat
 * in the customer list — so the console reported three homes on trial when one
 * of the three was us. That is the number a founder quotes at somebody.
 */

const ADMIN = "heather@holdingtoday.example";
const PASSWORD = "correct-horse-battery";

async function signInAdmin(email = ADMIN) {
  const agent = request.agent(app);

  const res = await agent
    .post("/api/auth/register")
    .send({ homeName: "Holding Today", email, password: PASSWORD })
    .expect(201);

  return { agent, homeId: res.body.home.id as number };
}

describe("the list", () => {
  beforeEach(async () => {
    await db.insert(platformAdminsTable).values({ email: ADMIN });
  });

  it("is readable from the console, and reading it is logged", async () => {
    const admin = await signInAdmin();

    const res = await admin.agent.get("/api/admin/admins").expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].email).toBe(ADMIN);

    const log = await db
      .select()
      .from(platformAuditTable)
      .where(eq(platformAuditTable.action, "platform.admins.list"));

    // "Who looked at the access list" is exactly what the log is for.
    expect(log).toHaveLength(1);
    expect(log[0]!.actorEmail).toBe(ADMIN);
  });

  it("adds somebody, and that grant is in the log with who did it", async () => {
    const admin = await signInAdmin();

    await admin.agent
      .post("/api/admin/admins")
      .send({ email: "Colleague@HoldingToday.example", displayName: "Sam Reed" })
      .expect(201);

    const rows = await db.select().from(platformAdminsTable);
    // Normalised, like every other address in this application.
    expect(rows.map((row) => row.email)).toContain("colleague@holdingtoday.example");

    const log = await db
      .select()
      .from(platformAuditTable)
      .where(eq(platformAuditTable.action, "platform.admin.grant"));

    expect(log).toHaveLength(1);
    expect(log[0]!.actorEmail).toBe(ADMIN);
    expect(log[0]!.detail).toContain("colleague@holdingtoday.example");
  });

  it("grants nothing on its own — the account still has to exist", async () => {
    const admin = await signInAdmin();

    await admin.agent
      .post("/api/admin/admins")
      .send({ email: "nobody@holdingtoday.example" })
      .expect(201);

    /*
     * The property that lets access be arranged before a new colleague's first
     * day without opening anything early: being named on the list is an
     * additional condition, never an alternative one.
     */
    await request(app).get("/api/admin/homes").expect(401);
  });

  it("revokes somebody, and the revocation survives as a record", async () => {
    const admin = await signInAdmin();
    await db.insert(platformAdminsTable).values({ email: "leaver@holdingtoday.example" });

    await admin.agent
      .delete(`/api/admin/admins/${encodeURIComponent("leaver@holdingtoday.example")}`)
      .expect(204);

    const [row] = await db
      .select()
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.email, "leaver@holdingtoday.example"));

    // Marked, not deleted: who had access when outlives them losing it.
    expect(row!.revokedAt).not.toBeNull();
    expect(row!.revokedByEmail).toBe(ADMIN);

    await admin.agent
      .delete(`/api/admin/admins/${encodeURIComponent("leaver@holdingtoday.example")}`)
      .expect(400);
  });

  it("restores a rejoiner rather than colliding with their old row", async () => {
    const admin = await signInAdmin();
    await db.insert(platformAdminsTable).values({
      email: "rejoiner@holdingtoday.example",
      revokedAt: new Date(),
      revokedByEmail: ADMIN,
    });

    await admin.agent
      .post("/api/admin/admins")
      .send({ email: "rejoiner@holdingtoday.example" })
      .expect(201);

    const rows = await db
      .select()
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.email, "rejoiner@holdingtoday.example"));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeNull();
  });

  it("will not let the last admin lock everyone out of the console", async () => {
    const admin = await signInAdmin();

    /*
     * Not about safety — a colleague can remove anyone. It is that the
     * alternative is a console with nobody in it and no way back except a
     * redeploy, which is the exact failure the environment variable caused.
     */
    const res = await admin.agent
      .delete(`/api/admin/admins/${encodeURIComponent(ADMIN)}`)
      .expect(400);

    expect(res.body.error).toContain("your own access");
    expect(await admin.agent.get("/api/admin/homes").expect(200)).toBeTruthy();
  });

  it("is not reachable by an ordinary director", async () => {
    const home = await signUpHome("Riverside Funeral Home");

    await home.agent.get("/api/admin/admins").expect(403);
    await home.agent
      .post("/api/admin/admins")
      .send({ email: "director@riverside.example" })
      .expect(403);
  });
});

describe("the bootstrap", () => {
  it("seeds the first admin into an empty table, then stops reading the variable", async () => {
    const previous = process.env["PLATFORM_ADMIN_EMAILS"];
    process.env["PLATFORM_ADMIN_EMAILS"] = ADMIN;

    try {
      await bootstrapPlatformAdmins();

      const seeded = await db.select().from(platformAdminsTable);
      expect(seeded).toHaveLength(1);
      expect(seeded[0]!.email).toBe(ADMIN);

      /*
       * The property that makes revocation actually work. If the bootstrap
       * seeded any named address at any time, then removing somebody from the
       * table would bring them back on the next restart — which is worse than
       * the problem it solves, because it would fail silently.
       */
      process.env["PLATFORM_ADMIN_EMAILS"] = "someone-else@holdingtoday.example";
      await bootstrapPlatformAdmins();

      const after = await db.select().from(platformAdminsTable);
      expect(after).toHaveLength(1);
      expect(after[0]!.email).toBe(ADMIN);
    } finally {
      if (previous === undefined) delete process.env["PLATFORM_ADMIN_EMAILS"];
      else process.env["PLATFORM_ADMIN_EMAILS"] = previous;
    }
  });

  it("does nothing at all when the variable is unset", async () => {
    const previous = process.env["PLATFORM_ADMIN_EMAILS"];
    delete process.env["PLATFORM_ADMIN_EMAILS"];

    try {
      await bootstrapPlatformAdmins();
      expect(await db.select().from(platformAdminsTable)).toHaveLength(0);
    } finally {
      if (previous !== undefined) process.env["PLATFORM_ADMIN_EMAILS"] = previous;
    }
  });
});

describe("ours, not a customer's", () => {
  beforeEach(async () => {
    await db.insert(platformAdminsTable).values({ email: ADMIN });
  });

  it("leaves our own home out of the customer list and the counts", async () => {
    const admin = await signInAdmin();
    await signUpHome("Riverside Funeral Home");
    await signUpHome("Oakwood Chapel");

    const before = await admin.agent.get("/api/admin/overview").expect(200);
    expect(before.body.homes.homes).toBe(3);

    await admin.agent
      .put(`/api/admin/homes/${admin.homeId}/internal`)
      .send({ internalAccount: true })
      .expect(200);

    const after = await admin.agent.get("/api/admin/overview").expect(200);

    // Two customers, both on trial. Neither number counts us any more.
    expect(after.body.homes.homes).toBe(2);
    expect(after.body.homes.onTrial).toBe(2);

    const listed = await admin.agent.get("/api/admin/homes").expect(200);
    expect(listed.body.homes.map((home: { name: string }) => home.name)).toEqual([
      "Oakwood Chapel",
      "Riverside Funeral Home",
    ]);
    expect(listed.body.total).toBe(2);
  });

  it("changes nothing else about the home, and is reversible", async () => {
    const admin = await signInAdmin();

    await admin.agent
      .put(`/api/admin/homes/${admin.homeId}/internal`)
      .send({ internalAccount: true })
      .expect(200);

    /*
     * An internal home is an ordinary tenant in every respect but the figures,
     * which is what makes it useful for trying something before a real home
     * sees it.
     */
    await admin.agent
      .post("/api/cases")
      .send({ decedentFirstName: "Margaret", decedentLastName: "Dunn" })
      .expect(201);

    const [home] = await db
      .select()
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.id, admin.homeId));
    expect(home!.suspendedAt).toBeNull();
    expect(home!.subscriptionStatus).toBe("trial");

    await admin.agent
      .put(`/api/admin/homes/${admin.homeId}/internal`)
      .send({ internalAccount: false })
      .expect(200);

    const back = await admin.agent.get("/api/admin/overview").expect(200);
    expect(back.body.homes.homes).toBe(1);
  });

  it("logs the change like any other write that touches a tenant", async () => {
    const admin = await signInAdmin();

    await admin.agent
      .put(`/api/admin/homes/${admin.homeId}/internal`)
      .send({ internalAccount: true })
      .expect(200);

    const log = await db
      .select()
      .from(platformAuditTable)
      .where(eq(platformAuditTable.action, "home.internal.update"));

    expect(log).toHaveLength(1);
    expect(log[0]!.detail).toBe("marked ours");
  });
});
