import request from "supertest";
import app from "../src/app";

/** A signed-in staff member, with the agent that carries their cookie. */
export type StaffSession = {
  agent: ReturnType<typeof request.agent>;
  homeId: number;
  userId: number;
  email: string;
};

let sequence = 0;

/**
 * Register a funeral home and return a signed-in agent for its owner.
 *
 * The owner's address is marked confirmed by default, because this helper
 * stands for "a home that has set itself up" and every test that uses it is
 * about something else. The one thing confirmation gates is the public request
 * form — see `routes/public.ts` — so a test about that form would otherwise be
 * testing the gate by accident, and a hundred tests about photographs would
 * fail for a reason none of them is interested in.
 *
 * Pass `{ verified: false }` to get a home nobody has heard from, which is what
 * `email-verification.test.ts` does on purpose.
 */
export async function signUpHome(
  name = "Horan & McConaty",
  options: { verified?: boolean } = {},
): Promise<StaffSession> {
  sequence += 1;
  const agent = request.agent(app);
  const email = `director${sequence}@example.com`;

  const res = await agent
    .post("/api/auth/register")
    .send({
      homeName: name,
      email,
      password: "correct-horse-battery",
      displayName: "Karen Voss",
    })
    .expect(201);

  if (options.verified !== false) {
    await markEmailVerified(email);
  }

  return {
    agent,
    homeId: res.body.home.id,
    userId: res.body.user.id,
    email,
  };
}

/** Confirm an address without going through the emailed link. */
export async function markEmailVerified(email: string): Promise<void> {
  const { db, usersTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  await db
    .update(usersTable)
    .set({ emailVerified: true })
    .where(eq(usersTable.email, email.toLowerCase()));
}

export async function createCase(
  staff: StaffSession,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; [key: string]: unknown }> {
  const res = await staff.agent
    .post("/api/cases")
    .send({
      decedentFirstName: "Margaret",
      decedentLastName: "Hale",
      ...overrides,
    })
    .expect(201);

  return res.body;
}

/** Add a family contact and return the token out of their one-time link. */
export async function inviteFamily(
  staff: StaffSession,
  caseId: number,
  overrides: Record<string, unknown> = {},
): Promise<{ contactId: number; token: string }> {
  const res = await staff.agent
    .post(`/api/cases/${caseId}/contacts`)
    .send({ name: "Anne Hale", role: "next_of_kin", ...overrides })
    .expect(201);

  const token = String(res.body.link).split("/f/")[1]!;
  return { contactId: res.body.id, token };
}

/** A request as the family, carrying the link token. */
export function asFamily(token: string) {
  return {
    get: (path: string) =>
      request(app).get(path).set("Authorization", `Bearer ${token}`),
    post: (path: string) =>
      request(app).post(path).set("Authorization", `Bearer ${token}`),
    put: (path: string) =>
      request(app).put(path).set("Authorization", `Bearer ${token}`),
    patch: (path: string) =>
      request(app).patch(path).set("Authorization", `Bearer ${token}`),
    delete: (path: string) =>
      request(app).delete(path).set("Authorization", `Bearer ${token}`),
  };
}

/** A 1x1 PNG, for upload tests. */
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
