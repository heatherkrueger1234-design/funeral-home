/**
 * The two origins every texted and emailed link is built from.
 *
 * A relative link is the quiet failure: nothing errors, and the text a
 * family receives opens nothing. These pin that production refuses to start
 * without both, and that the console is handed the finished public-page
 * address from the same place the texted links come from.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertLinkOriginsConfigured, publicPageUrl } from "../src/lib/origins";
import { signUpHome } from "./helpers";

const ORIGINAL = process.env["FAMILY_PORTAL_URL"];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env["FAMILY_PORTAL_URL"];
  else process.env["FAMILY_PORTAL_URL"] = ORIGINAL;
});

describe("refusing to start without link origins", () => {
  const good = {
    NODE_ENV: "production",
    FAMILY_PORTAL_URL: "https://continuumaftercare.com/family",
    CONSOLE_URL: "https://continuumaftercare.com",
  };

  it("starts when both are absolute URLs, trailing slash or not", () => {
    expect(() => assertLinkOriginsConfigured(good)).not.toThrow();
    expect(() =>
      assertLinkOriginsConfigured({
        ...good,
        CONSOLE_URL: "https://continuumaftercare.com/",
      }),
    ).not.toThrow();
  });

  it("refuses production without either, naming the one missing", () => {
    expect(() =>
      assertLinkOriginsConfigured({ ...good, FAMILY_PORTAL_URL: "" }),
    ).toThrow(/FAMILY_PORTAL_URL is not set/);
    expect(() =>
      assertLinkOriginsConfigured({ ...good, CONSOLE_URL: undefined }),
    ).toThrow(/CONSOLE_URL is not set/);
  });

  it("refuses a value that is not an absolute http(s) URL", () => {
    expect(() =>
      assertLinkOriginsConfigured({ ...good, FAMILY_PORTAL_URL: "/family" }),
    ).toThrow(/not an absolute http\(s\) URL/);
    expect(() =>
      assertLinkOriginsConfigured({
        ...good,
        CONSOLE_URL: "continuumaftercare.com",
      }),
    ).toThrow(/CONSOLE_URL/);
  });

  it("leaves development and tests alone, so a local run needs no DNS", () => {
    expect(() =>
      assertLinkOriginsConfigured({ NODE_ENV: "test" }),
    ).not.toThrow();
    expect(() => assertLinkOriginsConfigured({})).not.toThrow();
  });
});

describe("the home's public page address", () => {
  it("is built from the portal origin, and is null when there is none", () => {
    process.env["FAMILY_PORTAL_URL"] = "https://continuumaftercare.com/family/";
    expect(publicPageUrl("cedar-stone")).toBe(
      "https://continuumaftercare.com/family/start/cedar-stone",
    );
    delete process.env["FAMILY_PORTAL_URL"];
    expect(publicPageUrl("cedar-stone")).toBeNull();
  });

  it("is handed to the console on GET /home, from the same origin as the texted links", async () => {
    process.env["FAMILY_PORTAL_URL"] = "https://continuumaftercare.com/family";
    const staff = await signUpHome();
    const home = await staff.agent.get("/api/home").expect(200);
    expect(home.body.publicPageUrl).toBe(
      `https://continuumaftercare.com/family/start/${home.body.slug}`,
    );

    delete process.env["FAMILY_PORTAL_URL"];
    const again = await staff.agent.get("/api/home").expect(200);
    expect(again.body.publicPageUrl).toBeNull();
  });
});
