import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import {
  forgetCachedAnswers,
  holdsSomebodyElses,
  isSessionQuery,
  isUnauthorized,
  whoIsSignedIn,
} from "./session";

/**
 * Who the console thinks is at the keyboard decides whether it shows the
 * cases or the sign-in form. The mistake pinned here is the console carrying
 * on as somebody whose session the server had already ended.
 */
describe("whoIsSignedIn", () => {
  const heather = { user: { email: "heather@willowbank.example" } };

  /** What the API client throws when the server answers with this status. */
  const refused = (status: number) =>
    new ApiError(new Response(null, { status }), null, {
      method: "GET",
      url: "/api/auth/me",
    });

  it("is nobody once the server says the session has ended, even while holding the old answer", () => {
    // Signed out in another tab, or the owner took this person's access
    // away: the re-ask fails, and react-query keeps the answer it had
    // alongside the new error.
    expect(whoIsSignedIn({ data: heather, error: refused(401) })).toBeNull();
  });

  it("keeps the director signed in when a re-ask fails any other way", () => {
    // The API restarting, or the office wifi dropping, is not a reason to
    // put the sign-in form over a case somebody is in the middle of.
    for (const error of [refused(500), refused(503), new TypeError("Failed to fetch")]) {
      expect(whoIsSignedIn({ data: heather, error })).toBe(heather);
    }
  });

  it("is nobody when the server has never said who this is", () => {
    expect(whoIsSignedIn({ data: undefined, error: refused(401) })).toBeNull();
  });

  it("is whoever the server last named when nothing has failed", () => {
    expect(whoIsSignedIn({ data: heather, error: null })).toBe(heather);
  });
});

describe("isUnauthorized", () => {
  it("is true only for an error carrying a 401 status", () => {
    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(isUnauthorized({ status: 403 })).toBe(false);
    expect(isUnauthorized(new Error("boom"))).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});

/**
 * What one person's session fetched must not be shown to the next. Signing
 * out empties the cache; so must somebody else signing in, in another tab,
 * without anybody signing out -- the same shared office computer, the same
 * cookie, and until now the first person's cases still in the cache.
 */
describe("whose answers the cache holds", () => {
  it("holds nobody else's before anyone has signed in, or while the same person stays", () => {
    expect(holdsSomebodyElses(null, null)).toBe(false);
    expect(holdsSomebodyElses(null, 7)).toBe(false);
    expect(holdsSomebodyElses(7, 7)).toBe(false);
  });

  it("holds somebody else's once they have signed out", () => {
    expect(holdsSomebodyElses(7, null)).toBe(true);
  });

  it("holds somebody else's once another person has signed in over them", () => {
    expect(holdsSomebodyElses(7, 9)).toBe(true);
  });

  it("is emptied of everything but the session question itself", () => {
    const client = new QueryClient();
    client.setQueryData(getGetCurrentUserQueryKey(), { user: { id: 9 } });
    client.setQueryData(["/api/cases"], [{ id: 1 }]);
    client.setQueryData(["/api/cases/1"], { id: 1 });

    forgetCachedAnswers(client);

    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
      getGetCurrentUserQueryKey(),
    ]);
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
