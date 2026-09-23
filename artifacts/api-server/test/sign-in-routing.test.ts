import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { db, platformAdminsTable } from "@workspace/db";
import app from "../src/app";
import { signUpHome } from "./helpers";

/**
 * Telling a signed-in account which of the three apps is theirs.
 *
 * This product is three front ends on three hostnames, and nobody outside it
 * knows that. Somebody who has just typed their password correctly should be
 * told where to go rather than sent back to guess, and the alternative the
 * sign-in page had was to probe `/admin` and read the 403 — which is a client
 * inferring a permission from an error, the thing that goes wrong quietly the
 * first time the error changes.
 */
describe("the sign-in payload", () => {
  it("tells an ordinary director the platform console is not theirs", async () => {
    const staff = await signUpHome();

    const me = await staff.agent.get("/api/auth/me").expect(200);

    expect(me.body.platformAdmin).toBe(false);
    // And it is present rather than absent, so the client never has to treat
    // "missing" and "false" as the same thing.
    expect(me.body).toHaveProperty("platformAdmin");
  });

  it("tells a platform admin that it is", async () => {
    const staff = await signUpHome("Holding Today");
    await db.insert(platformAdminsTable).values({ email: staff.email });

    const me = await staff.agent.get("/api/auth/me").expect(200);

    expect(me.body.platformAdmin).toBe(true);
  });

  it("says so on the login response, not only on /auth/me", async () => {
    const staff = await signUpHome("Holding Today");
    await db.insert(platformAdminsTable).values({ email: staff.email });

    /*
     * The sign-in page routes on this the moment the password is accepted, so
     * a second round trip to find out would be a visible pause on the one
     * screen where somebody is watching.
     */
    const signedIn = await request(app)
      .post("/api/auth/login")
      .send({ email: staff.email, password: "correct-horse-battery" })
      .expect(200);

    expect(signedIn.body.platformAdmin).toBe(true);
  });

  it("says so on the register response too", async () => {
    const agent = request.agent(app);

    const opened = await agent
      .post("/api/auth/register")
      .send({
        homeName: "Riverside Funeral Home",
        email: "new-owner@riverside.example",
        password: "correct-horse-battery",
      })
      .expect(201);

    // A brand-new home is never a platform admin, and the field being there
    // means the page does not special-case registration.
    expect(opened.body.platformAdmin).toBe(false);
  });

  it("follows a revocation, because it is read rather than remembered", async () => {
    const staff = await signUpHome("Holding Today");
    await db.insert(platformAdminsTable).values({ email: staff.email });

    expect((await staff.agent.get("/api/auth/me").expect(200)).body.platformAdmin).toBe(true);

    await db.delete(platformAdminsTable);

    /*
     * The same session, and the answer changes. If this were baked into the
     * session at sign-in, somebody taken off the list would keep being sent to
     * a console that then refuses them for thirty days.
     */
    expect((await staff.agent.get("/api/auth/me").expect(200)).body.platformAdmin).toBe(false);
  });

  it("grants nothing on its own", async () => {
    const staff = await signUpHome();

    /*
     * The flag is a signpost, not a permission. `/admin` is gated by the same
     * table the flag reads, and a director whose payload says `false` is
     * refused there whatever any client chooses to do with it.
     */
    await staff.agent.get("/api/admin/homes").expect(403);
  });
});

describe("the family, who have no password at all", () => {
  beforeEach(async () => {
    await db.delete(platformAdminsTable);
  });

  it("cannot sign in, which is why the page points them elsewhere", async () => {
    const staff = await signUpHome();

    /*
     * There is no row in `users` for a family member and there is not meant to
     * be: a next of kin three days bereaved does not fill in a registration
     * form, so their texted link is the credential. Sign-in cannot help them,
     * and the only useful thing that screen can do is say so and send them to
     * the portal — which is what it now does.
     */
    await request(app)
      .post("/api/auth/login")
      .send({ email: "anne.whitfield@example.demo", password: "anything-at-all" })
      .expect(401);

    void staff;
  });
});
