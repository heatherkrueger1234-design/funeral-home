import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sendAccountExistsEmail } from "@workspace/mailer";
import app from "../src/app";
import { signUpHome } from "./helpers";

vi.mock("@workspace/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/mailer")>()),
  sendAccountExistsEmail: vi.fn(async () => undefined),
}));

describe("registration does not say who already has an account", () => {
  it("answers 'check your email' for a taken address and tells its owner", async () => {
    const staff = await signUpHome();

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        homeName: "Somebody Else's Chapel",
        email: staff.email,
        password: "a-different-password",
      })
      .expect(202);

    expect(res.body.checkEmail).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/already/i);
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Sent after the answer, not before it; see email-ceiling.test.ts.
    await vi.waitFor(() =>
      expect(sendAccountExistsEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: staff.email }),
      ),
    );
  });

  it("signs somebody in who registers again with their own password", async () => {
    const staff = await signUpHome("Horan & McConaty");

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        homeName: "Horan & McConaty",
        email: staff.email,
        password: "correct-horse-battery",
      })
      .expect(201);

    expect(res.body.home.id).toBe(staff.homeId);
  });
});

describe("authenticated answers are never cached", () => {
  it("sends no-store on staff, family and error responses", async () => {
    const staff = await signUpHome();

    const cases = await staff.agent.get("/api/cases").expect(200);
    expect(cases.headers["cache-control"]).toBe("no-store");

    const me = await staff.agent.get("/api/auth/me").expect(200);
    expect(me.headers["cache-control"]).toBe("no-store");

    const missing = await request(app).get("/api/family/session").expect(401);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });
});
