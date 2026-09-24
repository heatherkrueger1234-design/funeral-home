import { describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { db, passwordResetsTable, usersTable } from "@workspace/db";
import { signUpHome } from "./helpers";

/**
 * Sending an invitation again.
 *
 * The first link lasts an hour. A colleague invited at five opens the email in
 * the morning, and until this the owner's only option was to tell a new
 * member of staff to use "I've forgotten my password" on their first day.
 */

async function invite(owner: Awaited<ReturnType<typeof signUpHome>>, email = "eli@example.com") {
  const res = await owner.agent
    .post("/api/home/staff")
    .send({ email, displayName: "Eli Park", role: "director" })
    .expect(201);
  return res.body as { id: number; hasPassword: boolean; inviteLink: string };
}

describe("a fresh invitation", () => {
  it("lists hasPassword, and sends a new working link to someone who never chose one", async () => {
    const owner = await signUpHome();
    const eli = await invite(owner);
    expect(eli.hasPassword).toBe(false);

    const staff = await owner.agent.get("/api/home/staff").expect(200);
    const listed = staff.body.find((m: { id: number }) => m.id === eli.id);
    expect(listed.hasPassword).toBe(false);

    const again = await owner.agent
      .post(`/api/home/staff/${eli.id}/invitation`)
      .expect(200);
    expect(again.body.inviteLink).toMatch(/reset-password\?invited=1&token=/);
    expect(again.body.inviteLink).not.toBe(eli.inviteLink);

    const tokens = await db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, eli.id));
    expect(tokens).toHaveLength(2);

    // And the new link actually works.
    const token = decodeURIComponent(again.body.inviteLink.split("token=")[1]);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "a-long-new-password" })
      .expect((res) => expect(res.status).toBeLessThan(300));

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, eli.id));
    expect(row!.passwordHash).not.toBeNull();
  });

  it("refuses once they have a password, for somebody switched off, and for a director", async () => {
    const owner = await signUpHome();
    const eli = await invite(owner);

    // An ordinary director cannot send one.
    await db.update(usersTable).set({ role: "director" }).where(eq(usersTable.id, owner.userId));
    await owner.agent.post(`/api/home/staff/${eli.id}/invitation`).expect(403);
    await db.update(usersTable).set({ role: "owner" }).where(eq(usersTable.id, owner.userId));

    await db
      .update(usersTable)
      .set({ deactivatedAt: new Date() })
      .where(eq(usersTable.id, eli.id));
    await owner.agent.post(`/api/home/staff/${eli.id}/invitation`).expect(400);

    await db
      .update(usersTable)
      .set({ deactivatedAt: null, passwordHash: "set" })
      .where(eq(usersTable.id, eli.id));
    await owner.agent.post(`/api/home/staff/${eli.id}/invitation`).expect(400);
  });

  it("cannot reach somebody at another home", async () => {
    const ours = await signUpHome("Cedar & Stone");
    const theirs = await signUpHome("Horan & McConaty");
    const eli = await invite(theirs);

    await ours.agent.post(`/api/home/staff/${eli.id}/invitation`).expect(404);
    const tokens = await db
      .select()
      .from(passwordResetsTable)
      .where(eq(passwordResetsTable.userId, eli.id));
    expect(tokens).toHaveLength(1);
  });
});
