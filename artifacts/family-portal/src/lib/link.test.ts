import { describe, expect, it } from "vitest";
import { FORGETTING, isUnauthorized } from "./link";

/**
 * Importing this module at all is the first thing worth pinning: it reads
 * `window` at module scope (see the comment on `resolveToken` in link.tsx),
 * and this suite runs under vitest's "node" environment, where `window` does
 * not exist. If that defensive check ever regresses, this file fails to
 * import before a single assertion runs.
 */
describe("isUnauthorized", () => {
  it("is true only for an error carrying a 401 status", () => {
    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(isUnauthorized({ status: 500 })).toBe(false);
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});

/**
 * "Forget it here" lets go of the link this page kept. The visit to
 * `/f/<token>` stays in the browser's own history and its address-bar
 * suggestions, where no page can reach, and from there it opens the case
 * for whoever has the device next. So the words may promise only the first,
 * and must say how to undo the second.
 */
describe("what forgetting the link says it does", () => {
  it("promises nothing the browser's history can undo", () => {
    const said = `${FORGETTING.here} ${FORGETTING.inTheBrowser}`;
    expect(said).not.toMatch(/stop opening here/i);
    expect(said).not.toMatch(/until the link is opened again/i);
  });

  it("tells somebody on a borrowed device to clear the browser's history too", () => {
    expect(FORGETTING.inTheBrowser).toMatch(/isn't yours/);
    expect(FORGETTING.inTheBrowser).toMatch(/clear the browser's history/);
  });

  it("is written the way the portal speaks", () => {
    for (const sentence of Object.values(FORGETTING)) {
      expect(sentence).not.toContain("!");
      expect(sentence).toMatch(/\.$/);
    }
  });
});
