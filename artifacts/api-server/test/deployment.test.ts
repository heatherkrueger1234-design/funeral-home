/**
 * The mistakes that only show up once this is on a real host.
 *
 * Everything here passed in development and failed, or would have failed,
 * the first time it ran behind a reverse proxy. They are cheap to assert and
 * expensive to discover from a director saying "it just goes back to the
 * login page".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { logger } from "../src/lib/logger";

const ORIGINAL_NODE_ENV = process.env["NODE_ENV"];

let sequence = 0;

function registration() {
  sequence += 1;
  return {
    homeName: "Deployment Test Chapel",
    email: `deploy${sequence}-${Date.now()}@example.com`,
    password: "correct-horse-battery",
    displayName: "Karen Voss",
  };
}

describe("the session cookie, once there is a proxy in front", () => {
  afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = ORIGINAL_NODE_ENV;
    vi.restoreAllMocks();
  });

  it("is httpOnly and SameSite=Lax, so it survives a link opened from a text", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send(registration())
      .expect(201);

    const cookie = res.headers["set-cookie"]?.[0] ?? "";

    expect(cookie).toContain("fh_session=");
    // The whole point: script on the page must never be able to read it.
    expect(cookie.toLowerCase()).toContain("httponly");
    // Strict would drop the cookie on a cross-site navigation, which is
    // exactly how a director arrives from an email link.
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("says so loudly when it hands out a Secure cookie over plain HTTP", async () => {
    // The silent failure this exists to prevent: in production the cookie is
    // always Secure, and a browser accepts a Secure cookie over plain HTTP
    // and then never sends it again. Sign-in appears to do nothing at all.
    process.env["NODE_ENV"] = "production";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await request(app).post("/api/auth/register").send(registration()).expect(201);

    const messages = warn.mock.calls.map((call) => String(call[1] ?? ""));
    expect(messages.some((m) => m.includes("never send it back"))).toBe(true);
  });

  it("stays quiet when the proxy reports TLS, so the warning still means something", async () => {
    process.env["NODE_ENV"] = "production";
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    await request(app)
      .post("/api/auth/register")
      // What nginx sends. app.ts trusts one hop, so req.secure reads it.
      .set("x-forwarded-proto", "https")
      .send(registration())
      .expect(201);

    const messages = warn.mock.calls.map((call) => String(call[1] ?? ""));
    expect(messages.some((m) => m.includes("never send it back"))).toBe(false);
  });
});

describe("the health check a load balancer will poll", () => {
  it("answers without any credentials at all", async () => {
    // Probes arrive with no cookie, no bearer token and no Origin header. A
    // health check behind the auth gate takes every instance out of rotation
    // at once, which is how a deployment goes fully dark on a green deploy.
    await request(app).get("/api/healthz").expect(200);
  });
});

describe("CORS, which is what a wildcard would cost", () => {
  const ORIGINAL = process.env["CORS_ORIGINS"];

  beforeEach(() => {
    delete process.env["CORS_ORIGINS"];
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["CORS_ORIGINS"];
    else process.env["CORS_ORIGINS"] = ORIGINAL;
    vi.resetModules();
  });

  it("refuses to start with a wildcard rather than allowing one", async () => {
    process.env["CORS_ORIGINS"] = "https://console.example.com,*";
    const { corsOptions } = await import("../src/lib/cors");

    // Credentials travel on these requests. `*` plus cookies would let any
    // site on the internet read a signed-in director's cases, so this throws
    // at boot instead of serving it.
    expect(() => corsOptions()).toThrow(/must not contain/i);
  });

  it("allows a request with no Origin header, which is every health probe", async () => {
    const { corsOptions } = await import("../src/lib/cors");
    const { origin } = corsOptions();
    const callback = vi.fn();

    // cors types `origin` as a union that includes plain strings; this build
    // of it is always the callback form.
    expect(typeof origin).toBe("function");
    (origin as (o: string | undefined, cb: typeof callback) => void)(
      undefined,
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
