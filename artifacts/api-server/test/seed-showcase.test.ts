import { describe, expect, it } from "vitest";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import request from "supertest";
import { db, usersTable } from "@workspace/db";
import app from "../src/app";
import { signUpHome } from "./helpers";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * The demo account's sign-ins.
 *
 * `scripts/src/seed-showcase.ts` writes password hashes directly into the
 * database, because `scripts` does not depend on the API server and so cannot
 * call its `hashPassword`. That is a seam, and the failure it invites is a
 * quiet one: the seed keeps succeeding, nothing errors, and the first anybody
 * learns that the format drifted is a director typing a password in front of a
 * prospect and being told it is wrong.
 *
 * So this signs in with a hash written exactly the way the seed writes one,
 * through the real login route. It is deliberately not a unit test of the hash
 * function — what matters is that the whole path accepts it.
 */

/** Byte-for-byte what `seed-showcase.ts` produces. Keep the two in step. */
async function seedStylePasswordHash(password: string): Promise<string> {
  const params = { N: 16384, r: 8, p: 1 };
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString(
    "base64",
  )}$${derived.toString("base64")}`;
}

/* The three passwords the seed prints. If one of these ever fails the length
 * rule, the demo is broken and this is where it says so. */
const DEMO_PASSWORDS = [
  "ContinuumAdmin2026",
  "CedarStone2026",
  "CedarTeam2026",
] as const;

describe("the demo account's sign-ins", () => {
  it("accepts a password hashed the way the seed script hashes it", async () => {
    const staff = await signUpHome("Cedar & Stone Funeral Home");

    for (const password of DEMO_PASSWORDS) {
      await db
        .update(usersTable)
        .set({ passwordHash: await seedStylePasswordHash(password) })
        .where(eq(usersTable.id, staff.userId));

      const agent = request.agent(app);

      await agent
        .post("/api/auth/login")
        .send({ email: staff.email, password })
        .expect(200);

      // And the session it issued is a working one, not just a 200.
      await agent.get("/api/home/dashboard").expect(200);
    }
  });

  it("rejects the wrong password against a seed-written hash", async () => {
    const staff = await signUpHome();

    await db
      .update(usersTable)
      .set({ passwordHash: await seedStylePasswordHash("CedarStone2026") })
      .where(eq(usersTable.id, staff.userId));

    await request(app)
      .post("/api/auth/login")
      .send({ email: staff.email, password: "CedarStone2025" })
      .expect(401);
  });

  it("keeps every demo password inside the server's own length rule", async () => {
    const { MIN_PASSWORD_LENGTH } = await import("../src/lib/auth");

    /*
     * Registration enforces this and the seed bypasses it by writing the hash
     * directly, so raising the minimum would leave three demo accounts that
     * sign in fine but could never have been created — and the next person to
     * rotate them by hand would be stopped without knowing why.
     */
    for (const password of DEMO_PASSWORDS) {
      expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    }
  });
});
