import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import app from "../src/app";
import { addressKey, clientErrorRateLimit } from "../src/middleware/rate-limit";
import { MAX_UPLOADS_AT_ONCE, MAX_UPLOADS_PER_HOME, uploadsGate } from "../src/lib/media";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

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

/**
 * The downloads that cost the most to make, counted per home.
 *
 * Nothing else throttles a staff session, and each of these decrypts and
 * zips every photograph on a case, or walks every case the home has. What
 * matters is that the ceiling is the home's: reached by its own use, and
 * never spent by somebody else's.
 */
describe("the expensive downloads, per home", () => {
  it("turns away the twenty-first export in an hour, and only for that home", async () => {
    const staff = await signUpHome();
    const other = await signUpHome("Olinger Chapel");
    const row = await createCase(staff);
    const theirs = await createCase(other);

    for (let i = 0; i < 20; i += 1) {
      await staff.agent.get(`/api/cases/${row.id}/export`).expect(200);
    }
    const refused = await staff.agent.get(`/api/cases/${row.id}/export`).expect(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    expect(refused.body.error).toMatch(/exports/);

    // The other home's hour is its own.
    await other.agent.get(`/api/cases/${theirs.id}/export`).expect(200);
  });

  it("counts photo packs on their own, before the pack is built", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);

    // An empty case is refused with a 400 -- and that refusal is counted
    // too, since the ceiling is on asking, not on being answered.
    for (let i = 0; i < 20; i += 1) {
      await staff.agent.get(`/api/cases/${row.id}/photo-pack`).expect(400);
    }
    const refused = await staff.agent.get(`/api/cases/${row.id}/photo-pack`).expect(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

    // A pack's ceiling is not an export's.
    await staff.agent.get(`/api/cases/${row.id}/export`).expect(200);
  });

  it("allows thirty spreadsheets an hour, then says when to come back", async () => {
    const staff = await signUpHome();

    for (let i = 0; i < 30; i += 1) {
      await staff.agent.get("/api/export/cases.csv").expect(200);
    }
    const refused = await staff.agent.get("/api/export/cases.csv").expect(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  });
});

/**
 * The upload gate is one count for the whole process, so without a share
 * per home one family's evening could fill it and every other home's
 * uploads would be turned away for as long as theirs kept coming.
 */
describe("photographs arriving at once from one home", () => {
  /** Uploads that have started and promise far more than they send, so each holds its place. */
  function holdOpen(port: number, token: string, count: number): http.ClientRequest[] {
    const boundary = "----arriving";
    const arriving: http.ClientRequest[] = [];
    for (let i = 0; i < count; i += 1) {
      const upload = http.request({
        port,
        method: "POST",
        path: "/api/family/photos",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": String(10_000_000),
        },
      });
      upload.on("error", () => {});
      upload.write(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.png"\r\n` +
          "Content-Type: image/png\r\n\r\n",
      );
      arriving.push(upload);
    }
    return arriving;
  }

  it("holds one home to its share of the gate and leaves the rest for everybody else", async () => {
    expect(MAX_UPLOADS_PER_HOME).toBeLessThan(MAX_UPLOADS_AT_ONCE);

    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });

    const other = await signUpHome("Olinger Chapel");
    const theirs = await createCase(other);
    const { token: theirToken } = await inviteFamily(other, theirs.id, { name: "Tom Reyes" });

    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const arriving = holdOpen(port, token, MAX_UPLOADS_PER_HOME);

    try {
      await vi.waitFor(() => expect(uploadsGate.inUse).toBe(MAX_UPLOADS_PER_HOME));

      // The gate has room; this home has had its share.
      const turnedAway = await asFamily(token)
        .post("/api/family/photos")
        .attach("file", PNG_BYTES, "next.png")
        .expect(429);
      expect(Number(turnedAway.headers["retry-after"])).toBeGreaterThan(0);

      // And the room that is left is somebody else's.
      await asFamily(theirToken)
        .post("/api/family/photos")
        .attach("file", PNG_BYTES, "theirs.png")
        .expect(201);
    } finally {
      for (const upload of arriving) upload.destroy();
      await new Promise((resolve) => server.close(resolve));
    }

    // The share is given back with the slot.
    await vi.waitFor(() => expect(uploadsGate.inUse).toBe(0));
    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "next.png")
      .expect(201);
  });
});
