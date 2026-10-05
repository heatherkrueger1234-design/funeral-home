import { describe, expect, it } from "vitest";
import { photoSources, waitAfterFailure } from "./photo-src";

/**
 * A photograph drawn small is asked for as a thumbnail, so a bin of a
 * thousand is not a thousand full-size downloads; one drawn large, or framed
 * through a crop that magnifies it, is asked for whole.
 */
describe("where a photograph is drawn from", () => {
  it("is the thumbnail where it is drawn small", () => {
    expect(photoSources(12, "thumb")).toEqual({ src: "/api/uploads/12?size=thumb" });
  });

  it("is the photograph itself where it is drawn large", () => {
    expect(photoSources(12, "full")).toEqual({ src: "/api/uploads/12" });
  });

  it("in the bin's cards, is the thumbnail on an ordinary screen and the photograph on a sharper one", () => {
    expect(photoSources(12, "card")).toEqual({
      src: "/api/uploads/12?size=thumb",
      srcSet: "/api/uploads/12?size=thumb 1x, /api/uploads/12 2x",
    });
  });
});

describe("asking again after a photograph did not arrive", () => {
  it("waits longer each time, and gives up after the fourth", () => {
    expect([0, 1, 2, 3, 4, 5].map(waitAfterFailure)).toEqual([
      null,
      2_000,
      4_000,
      8_000,
      16_000,
      null,
    ]);
  });
});
