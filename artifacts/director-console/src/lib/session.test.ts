import { describe, expect, it } from "vitest";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { isSessionQuery, isUnauthorized } from "./session";

describe("isUnauthorized", () => {
  it("is true only for an error carrying a 401 status", () => {
    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(isUnauthorized({ status: 403 })).toBe(false);
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});

describe("isSessionQuery", () => {
  it("recognizes the current-user query key so its 401 can fail quietly", () => {
    expect(isSessionQuery(getGetCurrentUserQueryKey())).toBe(true);
  });

  it("does not mistake an unrelated query for the session query", () => {
    expect(isSessionQuery(["cases", "list"])).toBe(false);
    expect(isSessionQuery([])).toBe(false);
  });
});
