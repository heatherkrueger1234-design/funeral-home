import { describe, expect, it } from "vitest";
import { KNOCK_WINDOW_MS, knock, markTappedTwice, type Knock } from "./knock";

function play(clicks: Array<[Knock, number]>) {
  let history: ReturnType<typeof knock>["history"] = [];
  let door: ReturnType<typeof knock>["door"] = null;
  for (const [click, at] of clicks) {
    ({ history, door } = knock(history, click, at));
  }
  return { history, door };
}

describe("the hidden doors", () => {
  it("opens the platform console on mark, funeral, page", () => {
    expect(play([["mark", 0], ["funeral", 500], ["page", 900]]).door).toBe("admin");
  });

  it("opens the funeral home side on three taps of the mark", () => {
    expect(play([["mark", 0], ["mark", 300], ["mark", 600]]).door).toBe("home");
  });

  it("does not open on the words alone, or out of order", () => {
    expect(play([["funeral", 0], ["page", 300]]).door).toBeNull();
    expect(play([["page", 0], ["funeral", 300], ["mark", 600]]).door).toBeNull();
    expect(play([["mark", 0], ["page", 300], ["funeral", 600]]).door).toBeNull();
  });

  it("finds the sequence after stray clicks before it", () => {
    expect(
      play([["page", 0], ["funeral", 100], ["mark", 200], ["funeral", 300], ["page", 400]]).door,
    ).toBe("admin");
  });

  it("lets a knock go cold", () => {
    const slow = KNOCK_WINDOW_MS + 1;
    expect(play([["mark", 0], ["funeral", slow], ["page", slow + 100]]).door).toBeNull();
  });

  it("starts again once a door has opened", () => {
    const { history } = play([["mark", 0], ["funeral", 100], ["page", 200]]);
    expect(history).toEqual([]);
  });

  it("knows when the mark has been tapped twice and not yet a third time", () => {
    expect(markTappedTwice(play([["mark", 0], ["mark", 100]]).history)).toBe(true);
    expect(markTappedTwice(play([["mark", 0]]).history)).toBe(false);
    expect(markTappedTwice(play([["mark", 0], ["funeral", 100]]).history)).toBe(false);
  });
});
