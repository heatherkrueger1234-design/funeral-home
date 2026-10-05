import { describe, expect, it } from "vitest";
import { ApiError } from "@workspace/api-client-react";
import { askAgainForPhoto, waitBeforeAskingAgain } from "./photo-patience";

/**
 * A thumbnail is made the first time anybody asks for it, and the server
 * makes only so many at once, answering the rest "not yet" (429). The
 * photographs page used to ask once more a second later and then leave an
 * empty square. What is pinned here is that a "not yet" is waited out, and
 * that nothing else is asked about longer than it was.
 */

/** What the API client throws when the server answers with this status. */
function refused(status: number, retryAfter?: string): ApiError {
  return new ApiError(
    new Response(null, {
      status,
      headers: retryAfter ? { "retry-after": retryAfter } : {},
    }),
    null,
    { method: "GET", url: "/api/family/uploads/12?size=thumb" },
  );
}

describe("asking again for a photograph", () => {
  it("waits out a server that is busy making thumbnails, as long as it asks", () => {
    const busy = refused(429, "2");
    expect(askAgainForPhoto(0, busy)).toBe(true);
    expect(askAgainForPhoto(9, busy)).toBe(true);
    expect(askAgainForPhoto(10, busy)).toBe(false);
    expect(waitBeforeAskingAgain(0, busy)).toBe(2_000);
    expect(waitBeforeAskingAgain(5, busy)).toBe(2_000);
  });

  it("waits ten seconds when a busy server names no time", () => {
    expect(waitBeforeAskingAgain(0, refused(429))).toBe(10_000);
  });

  it("never asks again about a link that has stopped or a photograph that has gone", () => {
    expect(askAgainForPhoto(0, refused(401))).toBe(false);
    expect(askAgainForPhoto(0, refused(404))).toBe(false);
  });

  it("asks once more after anything else, such as a dropped connection", () => {
    for (const error of [refused(500), new TypeError("Failed to fetch")]) {
      expect(askAgainForPhoto(0, error)).toBe(true);
      expect(askAgainForPhoto(1, error)).toBe(false);
    }
    expect(waitBeforeAskingAgain(0, refused(500))).toBe(1_000);
  });
});
