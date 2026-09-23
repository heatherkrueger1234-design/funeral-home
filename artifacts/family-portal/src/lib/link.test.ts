import { describe, expect, it } from "vitest";
import { isUnauthorized } from "./link";

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
