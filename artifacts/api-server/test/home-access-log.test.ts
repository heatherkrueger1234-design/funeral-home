import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { eq } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  platformAuditTable,
  usersTable,
} from "@workspace/db";
import { markEmailVerified, signUpHome, type StaffSession } from "./helpers";
import { describeAccess } from "../src/lib/access-log";
import { AUDIT_ACTIONS } from "../src/routes/admin/shared";

/**
 * A home reading the platform's access log about itself.
 *
 * The log is the DPA's strongest promise ("here is every time anyone at the
 * vendor looked"), so the tests that matter are the ones about whose lines
 * come back: this home's, all of them, and nobody else's -- and only to the
 * owner, who is the person a home's insurer asks.
 */

const ADMIN_EMAIL = "heather@continuumaftercare.example";

async function signInPlatformAdmin() {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({
      homeName: "Continuum Aftercare",
      email: ADMIN_EMAIL,
      password: "correct-horse-battery",
      displayName: "Heather Krueger",
    })
    .expect(201);
  await markEmailVerified(ADMIN_EMAIL);
  return agent;
}

/** A second person at the home, with the director role and a password. */
async function addDirector(owner: StaffSession, email: string) {
  const invited = await owner.agent
    .post("/api/home/staff")
    .send({ email, displayName: "Marcus Alder", role: "director" })
    .expect(201);
  return invited.body as { id: number };
}

beforeEach(async () => {
  await db.insert(platformAdminsTable).values({ email: ADMIN_EMAIL });
});

describe("the access log a home can read about itself", () => {
  it("shows the owner every look at their home, newest first, in words", async () => {
    const admin = await signInPlatformAdmin();
    const home = await signUpHome("Horan & McConaty");

    await admin.get(`/api/admin/homes/${home.homeId}`).expect(200);
    await admin
      .post(`/api/admin/homes/${home.homeId}/extend-trial`)
      .send({ days: 7 })
      .expect(200);

    const log = await home.agent.get("/api/home/access-log").expect(200);

    expect(log.body.entries.map((entry: { action: string }) => entry.action)).toEqual([
      "home.trial.extend",
      "home.open",
    ]);
    const [extended, opened] = log.body.entries;
    expect(opened.what).toBe("Opened your account");
    expect(opened.who).toBe(ADMIN_EMAIL);
    expect(extended.what).toBe("Extended your free trial");
    expect(extended.detail).toMatch(/^7 more days/);
    expect(log.body.nextBefore).toBeNull();
  });

  it("never shows one home another home's lines", async () => {
    const admin = await signInPlatformAdmin();
    const mine = await signUpHome("Green Lawn");
    const theirs = await signUpHome("Elm Street");

    await admin.get(`/api/admin/homes/${theirs.homeId}`).expect(200);
    // A list of every customer names no single home, so it is in nobody's log.
    await admin.get("/api/admin/homes").expect(200);

    const log = await mine.agent.get("/api/home/access-log").expect(200);
    expect(log.body.entries).toEqual([]);

    const theirLog = await theirs.agent.get("/api/home/access-log").expect(200);
    expect(theirLog.body.entries).toHaveLength(1);
    expect(JSON.stringify(theirLog.body)).not.toContain("Green Lawn");
  });

  it("is the owner's to read, not every director's", async () => {
    const home = await signUpHome();
    await home.agent.get("/api/home/access-log").expect(200);

    // The same person, demoted: the role is read off their row per request,
    // the way staff-invitation.test.ts checks the other owner-only routes.
    await db
      .update(usersTable)
      .set({ role: "director" })
      .where(eq(usersTable.id, home.userId));

    await home.agent.get("/api/home/access-log").expect(403);
  });

  it("names the home's own colleague where the log only has an id", async () => {
    const admin = await signInPlatformAdmin();
    const owner = await signUpHome();
    const colleague = await addDirector(owner, "marcus@example.com");

    await admin
      .post(`/api/admin/homes/${owner.homeId}/staff/${colleague.id}/password-reset`)
      .expect(202);

    const log = await owner.agent.get("/api/home/access-log").expect(200);
    const line = log.body.entries.find(
      (entry: { action: string }) => entry.action === "home.staff.reset",
    );

    expect(line.what).toBe("Sent a sign-in email to one of your staff");
    expect(line.detail).toBe("resent the invitation to Marcus Alder");

    // The stored line itself is untouched: the log is evidence, and the
    // name is only how it is read back to the person it concerns.
    const [stored] = await db.select().from(platformAuditTable);
    expect(stored!.detail).toBe(`resent the invitation to staff #${colleague.id}`);
  });

  it("pages back through a long log without skipping a line", async () => {
    const home = await signUpHome();

    // Written directly: generating sixty real reads through the console would
    // fold together, which is the console's own rule and not this test's.
    await db.insert(platformAuditTable).values(
      Array.from({ length: 60 }, (_, index) => ({
        actorEmail: ADMIN_EMAIL,
        action: index % 2 === 0 ? "home.open" : "home.licensure.update",
        subjectHomeId: home.homeId,
        subjectHomeName: "Horan & McConaty",
        detail: `line ${index}`,
      })),
    );

    const first = await home.agent
      .get("/api/home/access-log?limit=25")
      .expect(200);
    const second = await home.agent
      .get(`/api/home/access-log?limit=25&before=${first.body.nextBefore}`)
      .expect(200);
    const third = await home.agent
      .get(`/api/home/access-log?limit=25&before=${second.body.nextBefore}`)
      .expect(200);

    const seen = [first, second, third].flatMap((page) =>
      page.body.entries.map((entry: { detail: string }) => entry.detail),
    );
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen[0]).toBe("line 59");
    expect(third.body.nextBefore).toBeNull();
  });

  it("still shows a line it has no words for, under its own code", async () => {
    const home = await signUpHome();
    await db.insert(platformAuditTable).values({
      actorEmail: ADMIN_EMAIL,
      action: "home.something.new",
      subjectHomeId: home.homeId,
      subjectHomeName: "Horan & McConaty",
    });

    const log = await home.agent.get("/api/home/access-log").expect(200);
    expect(log.body.entries[0].what).toBe('Recorded as "home.something.new"');
  });

  it("refuses a cursor that could not name a line", async () => {
    const home = await signUpHome();
    await home.agent.get("/api/home/access-log?before=99999999999").expect(400);
    await home.agent.get("/api/home/access-log?limit=500").expect(400);
  });
});

describe("the words an owner reads", () => {
  it("has a sentence for every action the platform can record about one home", () => {
    // A code with no sentence still shows, as `Recorded as "home.sms.update"`,
    // which is honest and unreadable. Every new home.* action needs words.
    const missing = AUDIT_ACTIONS.filter(
      (action) =>
        action.startsWith("home.") &&
        describeAccess(action).startsWith("Recorded as"),
    );
    expect(missing).toEqual([]);
  });
});
