import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { addressKey, clientErrorRateLimit } from "../src/middleware/rate-limit";

/**
 * Who a limiter counts as one caller.
 *
 * An IPv6 connection comes with a /64 -- more addresses than anybody will
 * ever use -- and a device can send each request from a different one.
 * Counted by the whole address, a household could make as many sign-in
 * guesses as it liked.
 */
describe("counting by address", () => {
  it("counts an IPv6 caller by their /64, however they write it", () => {
    expect(addressKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressKey("1::2:3:4:5:6:7")).toBe("1:0:2:3::/64");
    expect(addressKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressKey("64:ff9b::198.51.100.1")).toBe("64:ff9b:0:0::/64");
  });

  it("leaves IPv4 as it is, including on a dual-stack socket", () => {
    expect(addressKey("203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(addressKey("unknown")).toBe("unknown");
  });

  it("does not hand a new bucket to each address in the same /64", async () => {
    clientErrorRateLimit.reset();
    const report = { app: "console", kind: "error", message: "again", path: "/" };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app)
        .post("/api/client-errors")
        .set("X-Forwarded-For", `2001:db8:1:2::${(attempt + 1).toString(16)}`)
        .send(report)
        .expect(204);
    }
    await request(app)
      .post("/api/client-errors")
      .set("X-Forwarded-For", "2001:db8:1:2::ffff")
      .send(report)
      .expect(429);

    // A different line is somebody else.
    await request(app)
      .post("/api/client-errors")
      .set("X-Forwarded-For", "2001:db8:1:3::1")
      .send(report)
      .expect(204);
    clientErrorRateLimit.reset();
  });
});
