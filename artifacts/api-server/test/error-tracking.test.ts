import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import * as Sentry from "@sentry/node";
import app from "../src/app";
import {
  flushErrorTracking,
  initErrorTracking,
  reportError,
  scrubEvent,
  scrubPath,
  scrubText,
} from "../src/lib/error-tracking";
import { clientErrorRateLimit } from "../src/middleware/rate-limit";

/**
 * Error tracking, and mostly what it must never send.
 *
 * An error tracker is a third party, and this product holds social security
 * numbers, causes of death and family link tokens. The tests that matter
 * read what would actually have left the process.
 */

const TOKEN = "q3Yf8WlZr0nT5kXcPz1aBvD7sHeJm2Ug9_-oIQ4tNwE";

describe("scrubbing", () => {
  it("takes the personal shapes out of a message", () => {
    const scrubbed = scrubText(
      `duplicate key (email)=(anne.whitfield@example.com) for ${TOKEN}, ` +
        "SSN 531-22-4417, call (555) 018-2240, Authorization: Bearer abc.def",
    );

    expect(scrubbed).not.toContain("anne.whitfield");
    expect(scrubbed).not.toContain(TOKEN);
    expect(scrubbed).not.toContain("531-22-4417");
    expect(scrubbed).not.toContain("018-2240");
    expect(scrubbed).not.toContain("abc.def");
    expect(scrubbed).toContain("[email]");
    expect(scrubbed).toContain("[token]");
  });

  it("keeps what makes an error reproducible", () => {
    // A row id and the shape of the failure are not personal data.
    expect(scrubText("Case 412 not found in cases_pkey")).toBe(
      "Case 412 not found in cases_pkey",
    );
  });

  it("never reports a family link, a query string or a fragment", () => {
    expect(scrubPath(`/f/${TOKEN}/photos?sort=new#top`)).toBe(
      "/f/[token]/photos",
    );
    expect(scrubPath(`/reset-password/${TOKEN}`)).toBe(
      "/reset-password/[token]",
    );
    expect(scrubPath("/api/cases/12/vitals")).toBe("/api/cases/12/vitals");
  });

  it("removes the request, the user, breadcrumbs and local variables", () => {
    const event = scrubEvent({
      type: undefined,
      message: "for anne@example.com",
      request: { url: `https://x/f/${TOKEN}`, cookies: { sid: "secret" } },
      user: { email: "anne@example.com" },
      breadcrumbs: [{ message: "GET /f/token" }],
      extra: { body: "everything" },
      exception: {
        values: [
          {
            type: "Error",
            value: `lookup failed for ${TOKEN}`,
            stacktrace: {
              frames: [{ function: "f", vars: { ssn: "531224417" } }],
            },
          },
        ],
      },
    });

    expect(event.request).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.message).toBe("for [email]");
    expect(event.exception!.values![0]!.value).toBe(
      "lookup failed for [token]",
    );
    expect(
      event.exception!.values![0]!.stacktrace!.frames![0]!.vars,
    ).toBeUndefined();
  });

  it("is a no-op until it is switched on", () => {
    expect(() =>
      reportError(new Error("nobody is listening"), { source: "api" }),
    ).not.toThrow();
  });
});

describe("what actually leaves the process", () => {
  const sent: string[] = [];

  afterAll(async () => {
    await Sentry.close();
    delete process.env["SENTRY_DSN"];
  });

  it("sends a scrubbed event, tagged with where it came from", async () => {
    process.env["SENTRY_DSN"] = "https://public@o0.ingest.sentry.io/0";
    expect(
      initErrorTracking({
        transport: (options) =>
          Sentry.createTransport(options, async (envelope) => {
            sent.push(
              typeof envelope.body === "string"
                ? envelope.body
                : new TextDecoder().decode(envelope.body),
            );
            return { statusCode: 200 };
          }),
      }),
    ).toBe(true);

    reportError(
      new Error(`insert failed: (email)=(anne@example.com) ${TOKEN}`),
      {
        source: "family",
        route: `/f/${TOKEN}/vitals`,
        method: "PUT",
        status: 500,
      },
    );

    // And a browser's report, through the endpoint the front ends use.
    clientErrorRateLimit.reset();
    await request(app)
      .post("/api/client-errors")
      .send({
        app: "family",
        kind: "render",
        message:
          "Cannot read properties of undefined (reading 'name') for anne@example.com",
        stack: `TypeError: boom\n    at Hub (https://x/f/${TOKEN}/assets/index.js:1:200)`,
        path: `/f/${TOKEN}`,
      })
      .expect(204);

    await flushErrorTracking();

    const everything = sent.join("\n");
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(everything).not.toContain("anne@example.com");
    expect(everything).not.toContain(TOKEN);
    expect(everything).toContain("[email]");
    expect(everything).toContain('"source":"family"');
    expect(everything).toContain("/f/[token]/vitals");
    expect(everything).toContain("family render");
  });
});

describe("the crash report endpoint", () => {
  it("refuses a report that is not one", async () => {
    clientErrorRateLimit.reset();
    await request(app)
      .post("/api/client-errors")
      .send({ app: "somebody-else", kind: "render", message: "x", path: "/" })
      .expect(400);
    await request(app)
      .post("/api/client-errors")
      .send({
        app: "console",
        kind: "render",
        message: "x".repeat(1001),
        path: "/",
      })
      .expect(400);
  });

  it("stops a screen that fails in a loop from flooding the log", async () => {
    clientErrorRateLimit.reset();
    const report = {
      app: "console",
      kind: "error",
      message: "again",
      path: "/",
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).post("/api/client-errors").send(report).expect(204);
    }
    await request(app).post("/api/client-errors").send(report).expect(429);
    clientErrorRateLimit.reset();
  });
});
