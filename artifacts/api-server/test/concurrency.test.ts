import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import app from "../src/app";
import { Gate } from "../src/lib/concurrency";
import { MAX_UPLOADS_AT_ONCE, MAX_UPLOADS_PER_HOME, uploadsGate } from "../src/lib/media";
import { asFamily, createCase, inviteFamily, signUpHome, PNG_BYTES } from "./helpers";

/**
 * Two things are dangerous in a crowd rather than one at a time: an upload,
 * held in memory whole before it can be looked at, and a password check,
 * which takes one of the four threads Node keeps for slow work. Both are now
 * counted for the whole process, not per address.
 */
describe("a gate", () => {
  it("lets in as many as it holds, and turns the next away without waiting", () => {
    const gate = new Gate(2);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);

    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });

  it("keeps a line, hands a freed slot straight to it, and refuses past its length", async () => {
    const gate = new Gate(1, 2);
    expect(await gate.enter()).toBe(true);

    let first = false;
    let second = false;
    const firstInLine = gate.enter().then((ok) => (first = ok));
    const secondInLine = gate.enter().then((ok) => (second = ok));
    expect(gate.inLine).toBe(2);

    // The line is full, so a third is answered at once.
    expect(await gate.enter()).toBe(false);

    gate.leave();
    await firstInLine;
    expect(first).toBe(true);
    expect(second).toBe(false);
    // Handed over, not freed and re-taken: still one in use.
    expect(gate.inUse).toBe(1);

    gate.leave();
    await secondInLine;
    expect(second).toBe(true);
    gate.leave();
    expect(gate.inUse).toBe(0);
  });
});

describe("photographs arriving at once", () => {
  it("turns the one past the limit away with a wait, and lets it in once there is room", async () => {
    const staff = await signUpHome();
    const row = await createCase(staff);
    const { token } = await inviteFamily(staff, row.id, { name: "Anne Hale" });

    /*
     * No one home may hold more than its share (MAX_UPLOADS_PER_HOME), so
     * filling the gate takes several homes' families at once.
     */
    const tokens: string[] = [];
    for (let home = 0; home * MAX_UPLOADS_PER_HOME < MAX_UPLOADS_AT_ONCE; home += 1) {
      const other = await signUpHome(`Chapel ${home}`);
      const theirs = await createCase(other);
      tokens.push((await inviteFamily(other, theirs.id, { name: "Tom Reyes" })).token);
    }

    /*
     * Uploads that have started and not finished: each sends its headers
     * and the start of a file, and promises far more than it sends, so
     * each holds its place the way a slow phone connection does.
     */
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const boundary = "----arriving";
    const arriving: http.ClientRequest[] = [];

    try {
      for (let i = 0; i < MAX_UPLOADS_AT_ONCE; i += 1) {
        const upload = http.request({
          port,
          method: "POST",
          path: "/api/family/photos",
          headers: {
            Authorization: `Bearer ${tokens[Math.floor(i / MAX_UPLOADS_PER_HOME)]}`,
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
      await vi.waitFor(() => expect(uploadsGate.inUse).toBe(MAX_UPLOADS_AT_ONCE));

      const turnedAway = await asFamily(token)
        .post("/api/family/photos")
        .attach("file", PNG_BYTES, "next.png")
        .expect(429);
      expect(Number(turnedAway.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      for (const upload of arriving) upload.destroy();
      await new Promise((resolve) => server.close(resolve));
    }

    // Their places are given back when they go, however they go.
    await vi.waitFor(() => expect(uploadsGate.inUse).toBe(0));
    await asFamily(token)
      .post("/api/family/photos")
      .attach("file", PNG_BYTES, "next.png")
      .expect(201);
  });
});
