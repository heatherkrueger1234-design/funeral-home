import { describe, expect, it } from "vitest";
import { voiceFor } from "./voice";

/**
 * Getting this wrong sends a sympathy line to someone arranging their own
 * funeral, about themselves, while they are alive — see the comment on
 * voiceFor itself. That is worth pinning with more than a read-through.
 */
describe("voiceFor", () => {
  it("speaks about a decedent in the third person for an at-need case", () => {
    const voice = voiceFor("at_need");

    expect(voice.preNeed).toBe(false);
    expect(voice.heading("Eleanor Vance")).toBe("Eleanor Vance");
    expect(voice.strapline("Eleanor Vance")).toBe("For Eleanor Vance");
    expect(voice.possessive("Eleanor Vance")).toBe("Eleanor Vance's");
  });

  it("speaks directly to the person for a pre-need case", () => {
    const voice = voiceFor("pre_need");

    expect(voice.preNeed).toBe(true);
    expect(voice.heading("Eleanor Vance")).toBe("Your plan");
    expect(voice.strapline("Eleanor Vance")).toBe("Eleanor Vance's plan");
    expect(voice.possessive("Eleanor Vance")).toBe("your");
  });

  it("treats an unrecognized or missing kind as at-need, never pre-need", () => {
    // Silently defaulting to the pre-need voice on a typo'd or unknown
    // `kind` would be the exact failure this file exists to prevent.
    expect(voiceFor(undefined).preNeed).toBe(false);
    expect(voiceFor("").preNeed).toBe(false);
    expect(voiceFor("something-unexpected").preNeed).toBe(false);
  });
});
