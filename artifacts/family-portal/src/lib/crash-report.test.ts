import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The crash reporter, and the one thing it must never send: the family's
 * link. Run in node, so the page's `window` and `fetch` are stood in for.
 */

const sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetModules();
  sent.length = 0;
  vi.stubGlobal("window", {
    location: { pathname: "/f/q3Yf8WlZr0nT5kXcPz1aBvD7sHeJm2Ug9_-oIQ4tNwE/photos" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reporting a crash", () => {
  it("never sends the token from the family's link", async () => {
    const { reportCrash } = await import("./crash-report");
    reportCrash("family", "render", new Error("Cannot read properties of undefined"));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe("/f/[token]/photos");
    expect(JSON.stringify(sent[0])).not.toContain("q3Yf8WlZr0nT5k");
    expect(sent[0]!.app).toBe("family");
    expect(sent[0]!.kind).toBe("render");
  });

  it("sends one report per distinct failure, and only a handful per page", async () => {
    const { reportCrash } = await import("./crash-report");

    for (let i = 0; i < 3; i += 1) reportCrash("family", "error", new Error("same"));
    expect(sent).toHaveLength(1);

    for (let i = 0; i < 10; i += 1) reportCrash("family", "error", new Error(`different ${i}`));
    // A screen failing in a loop cannot flood anyone.
    expect(sent).toHaveLength(5);
  });

  it("ignores what comes from outside the portal", async () => {
    const { reportCrash } = await import("./crash-report");
    reportCrash("family", "error", new Error("ResizeObserver loop completed with undelivered notifications."));

    const extension = new Error("boom");
    extension.stack = "Error: boom\n    at chrome-extension://abcdef/content.js:1:1";
    reportCrash("family", "error", extension);

    expect(sent).toHaveLength(0);
  });

  it("reports something useful when what was thrown is not an Error", async () => {
    const { reportCrash } = await import("./crash-report");
    reportCrash("family", "rejection", "the network went away");
    reportCrash("family", "rejection", { odd: true });

    expect(sent.map((report) => report.message)).toEqual([
      "the network went away",
      "Unknown error",
    ]);
  });

  it("never throws, even when it cannot send", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no network at all");
    });
    const { reportCrash } = await import("./crash-report");
    expect(() => reportCrash("family", "render", new Error("x"))).not.toThrow();
  });
});

describe("the path that is reported", () => {
  it("takes the token out of every kind of link that carries one", async () => {
    const { reportablePath } = await import("./crash-report");
    expect(reportablePath("/f/abc123/memory-book")).toBe("/f/[token]/memory-book");
    expect(reportablePath("/family/f/abc123")).toBe("/family/f/[token]");
    expect(reportablePath("/start/cedar-and-stone")).toBe("/start/cedar-and-stone");
  });
});
