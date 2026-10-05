import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { FORGETTING, isUnauthorized, refusedForTheLink, stoppedLinkWords } from "./link";

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

/**
 * The expired-link screen arrives the moment a save is refused, so the
 * change in the refused save -- the paragraph somebody had just finished
 * and left the box -- is the one thing that did not arrive. It used to be
 * told "Nothing you have already added has been lost", and went away
 * believing it had been kept.
 */
describe("what the expired-link screen says about the family's work", () => {
  /** What the API client throws when the server answers with this status. */
  const refused = (status: number) =>
    new ApiError(new Response(null, { status }), null, {
      method: "PUT",
      url: "/api/family/obituary",
    });

  async function aSave(client: QueryClient, error: unknown) {
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(error), retry: false })
      .execute(undefined)
      .catch(() => undefined);
  }

  it("notices a save refused because the link stopped, and no other failure", async () => {
    const client = new QueryClient();
    const cache = client.getMutationCache();

    await aSave(client, refused(500));
    await aSave(client, new TypeError("Failed to fetch"));
    expect(cache.findAll(refusedForTheLink)).toHaveLength(0);

    await aSave(client, refused(401));
    expect(cache.findAll(refusedForTheLink)).toHaveLength(1);
  });

  it("says what was kept, and that the last change was not, when a save was refused", () => {
    const words = stoppedLinkWords(true);
    expect(words).not.toMatch(/nothing/i);
    expect(words).toMatch(/couldn't be saved/);
    expect(words).toMatch(/new link/);
    expect(words).toMatch(/before then is safe/);
  });

  it("still says nothing was lost when nothing was being saved", () => {
    expect(stoppedLinkWords(false)).toMatch(/Nothing you have already added has been lost\.$/);
  });

  it("never blames, never exclaims", () => {
    for (const words of [stoppedLinkWords(true), stoppedLinkWords(false)]) {
      expect(words).not.toContain("!");
      expect(words).not.toMatch(/\byou failed\b|\bfailed to\b/i);
    }
  });
});
