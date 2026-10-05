/**
 * The API noticing when it cannot see who is calling.
 *
 * TRUST_PROXY_HOPS set too low leaves every visitor looking like the
 * innermost proxy, so they all share every rate limit -- one family's
 * retries throttle everybody -- and nothing says so. These pin the one thing
 * that can: a request arriving from a private address with a public one
 * further back in X-Forwarded-For than the hops trusted reach.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import app from "../src/app";
import { logger } from "../src/lib/logger";
import { proxyHopsCheck, tooFewProxyHops } from "../src/lib/trust-proxy";

// What reaches the API in the compose stack: Caddy writes the visitor's
// address, then nginx appends Caddy's own on the way through.
const THROUGH_CADDY_AND_NGINX = "203.0.113.7, 172.18.0.5";
const ADDRESSES = ["203.0.113.7", "172.18.0.5"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("whether the hops trusted look too few", () => {
  it("says so when every visitor would be seen as the proxy", () => {
    // One hop trusted behind two: req.ip is Caddy's private address.
    expect(tooFewProxyHops(1, "172.18.0.5", THROUGH_CADDY_AND_NGINX)).toEqual({
      seenAs: "private",
      forwardedFor: { public: 1, private: 1 },
      atLeast: 2,
    });
    // None trusted at all, straight behind one proxy.
    expect(tooFewProxyHops(0, "::ffff:127.0.0.1", "203.0.113.7")).toMatchObject({
      seenAs: "loopback",
      atLeast: 1,
    });
  });

  it("is quiet when the visitor is seen", () => {
    expect(tooFewProxyHops(2, "203.0.113.7", THROUGH_CADDY_AND_NGINX)).toBeNull();
    // Nothing forwarded: a health probe, or no proxy at all.
    expect(tooFewProxyHops(1, "127.0.0.1", undefined)).toBeNull();
  });

  it("is quiet for a network with nobody public on it", () => {
    // A home's own office, reaching a server on its own network: private
    // all the way back, which is no evidence of anything.
    expect(tooFewProxyHops(1, "172.18.0.5", "192.168.1.20, 172.18.0.5")).toBeNull();
    expect(tooFewProxyHops(1, "fd00::5", "fe80::1, fd00::5")).toBeNull();
  });

  it("does not count a trusted proxy's own public address against the setting", () => {
    // A public hop inside the ones trusted (a CDN's edge, say), with a
    // private address beyond it: not a sign of too few.
    expect(tooFewProxyHops(2, "10.0.0.5", "10.0.0.5, 104.16.0.1")).toBeNull();
  });

  it("reads the forms proxies write addresses in", () => {
    expect(
      tooFewProxyHops(1, "10.1.2.3", "[2001:db8::7]:443, 203.0.113.7:51234, unknown, 10.1.2.3"),
    ).toEqual({
      seenAs: "private",
      forwardedFor: { public: 2, unparseable: 1, private: 1 },
      atLeast: 3,
    });
    // What the API itself may see on a dual-stack socket.
    expect(tooFewProxyHops(1, "::ffff:100.64.0.9", "203.0.113.7, 100.64.0.9")).toMatchObject({
      seenAs: "private",
    });
  });
});

describe("the warning", () => {
  it("is given once by the app, naming the setting and never an address", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    for (let i = 0; i < 3; i += 1) {
      await request(app).get("/api/healthz").set("x-forwarded-for", THROUGH_CADDY_AND_NGINX);
    }

    const warnings = warn.mock.calls.filter((call) =>
      String(call[1] ?? "").includes("TRUST_PROXY_HOPS"),
    );
    expect(warnings).toHaveLength(1);
    const [fields, message] = warnings[0]!;
    expect(String(message)).toMatch(/TRUST_PROXY_HOPS is 1/);
    expect(String(message)).toMatch(/at least 2/);
    expect(fields).toMatchObject({ trustProxyHops: 1, seenAs: "private", atLeast: 2 });
    for (const address of ADDRESSES) {
      expect(JSON.stringify(warnings[0])).not.toContain(address);
    }
  });

  it("stays quiet with the hops set right", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const probe = express();
    probe.set("trust proxy", 2);
    probe.use(proxyHopsCheck(2));
    probe.get("/", (_req, res) => {
      res.end();
    });

    await request(probe).get("/").set("x-forwarded-for", THROUGH_CADDY_AND_NGINX);

    expect(warn).not.toHaveBeenCalled();
  });

  it("is given again a day later, if nothing has changed", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    let now = Date.parse("2026-10-05T09:00:00Z");
    const probe = express();
    probe.set("trust proxy", 1);
    probe.use(proxyHopsCheck(1, () => now));
    probe.get("/", (_req, res) => {
      res.end();
    });
    const visit = () => request(probe).get("/").set("x-forwarded-for", THROUGH_CADDY_AND_NGINX);

    await visit();
    now += 23 * 60 * 60 * 1000;
    await visit();
    expect(warn).toHaveBeenCalledTimes(1);

    now += 60 * 60 * 1000;
    await visit();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
