/**
 * Who an invitation can be emailed to, and how often.
 *
 * Anybody can register a home, name it anything, and add colleagues by
 * typing their addresses; each one is emailed, from our domain, with the
 * home's name in it. Without a limit that is a way to send any number of
 * strangers a message that says what the sender likes, until the mail
 * provider suspends the domain and every home's resets and check-ins stop
 * with it. The transport is the only thing faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mail = vi.hoisted(() => {
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "apikey";
  process.env["SMTP_PASS"] = "not-a-real-key";
  process.env["SMTP_FROM"] = "Continuum Aftercare <care@holding.example>";
  return [] as Array<Record<string, unknown>>;
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        mail.push(message);
      },
      verify: async () => true,
    }),
  },
}));

import { db, usersTable } from "@workspace/db";
import { markEmailVerified, signUpHome } from "./helpers";

type Owner = Awaited<ReturnType<typeof signUpHome>>;

beforeEach(() => {
  mail.length = 0;
});

/** A home whose owner has confirmed their address, as `signUpHome` gives. */
function confirmed(name = "Aspen & Vale"): Promise<Owner> {
  return signUpHome(name);
}

function invitationsTo(address: string) {
  return mail.filter(
    (message) => message["to"] === address && String(message["subject"]).startsWith("You've been added"),
  );
}

describe("an invitation", () => {
  it("is emailed only once somebody at the home has confirmed their address, and the link is the owner's either way", async () => {
    const owner = await signUpHome("Spin & Win Prizes", { verified: false });
    mail.length = 0;

    const added = await owner.agent
      .post("/api/home/staff")
      .send({ email: "stranger@example.com", role: "director" })
      .expect(201);

    // A home nobody has confirmed is a home we have not heard from: its name
    // does not go out under ours. Nobody is locked out of adding a colleague,
    // though -- the link is in the answer, to hand over.
    expect(added.body.emailed).toBe(false);
    expect(added.body.notEmailedBecause).toMatch(/confirmed/i);
    expect(added.body.inviteLink).toMatch(/token=/);
    expect(invitationsTo("stranger@example.com")).toHaveLength(0);

    await markEmailVerified(owner.email);

    const sent = await owner.agent
      .post(`/api/home/staff/${added.body.id}/invitation`)
      .expect(200);
    expect(sent.body.emailed).toBe(true);
    expect(sent.body.notEmailedBecause).toBeNull();
    expect(invitationsTo("stranger@example.com")).toHaveLength(1);
  });

  it("goes to one address only so many times, however often it is sent again", async () => {
    const owner = await confirmed();
    const added = await owner.agent
      .post("/api/home/staff")
      .send({ email: "eli@example.com", role: "director" })
      .expect(201);
    expect(added.body.emailed).toBe(true);

    const again = () =>
      owner.agent.post(`/api/home/staff/${added.body.id}/invitation`).expect(200);
    expect((await again()).body.emailed).toBe(true);
    expect((await again()).body.emailed).toBe(true);

    // Unlimited before: one owner could fill one stranger's inbox.
    const fourth = await again();
    expect(fourth.body.emailed).toBe(false);
    expect(fourth.body.notEmailedBecause).toMatch(/several/i);
    expect(fourth.body.inviteLink).toMatch(/token=/);
    expect(invitationsTo("eli@example.com")).toHaveLength(3);
  });

  it("is sent to only so many new people a day from one home", async () => {
    const owner = await confirmed();

    // The owner who registered today is the first of the day's twenty.
    for (let i = 1; i < 20; i += 1) {
      await owner.agent
        .post("/api/home/staff")
        .send({ email: `colleague${i}@example.com`, role: "staff" })
        .expect(201);
    }

    // More people than a funeral home takes on in a day, which is all a
    // list of strangers' addresses ever was.
    const refused = await owner.agent
      .post("/api/home/staff")
      .send({ email: "one-too-many@example.com", role: "staff" })
      .expect(429);
    expect(refused.body.error).toMatch(/tomorrow/i);
    expect(invitationsTo("one-too-many@example.com")).toHaveLength(0);

    const [row] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, "one-too-many@example.com"));
    expect(row).toBeUndefined();
  });
});
