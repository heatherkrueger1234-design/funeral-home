import { describe, expect, it } from "vitest";
import { takeServerText } from "./shared-field";

/**
 * Two relatives on the same obituary field, and the session poll that
 * refreshes it under both of them every couple of minutes.
 */
describe("takeServerText", () => {
  const onFile = "Survived by her daughter Ruth";
  const sisterWrote = "Survived by her daughter Ruth and her son Thomas";

  it("shows a sibling's newer text when nobody is in the box", () => {
    const field = { draft: onFile, agreed: onFile };
    expect(takeServerText(field, sisterWrote, false)).toEqual({
      draft: sisterWrote,
      agreed: sisterWrote,
    });
  });

  it("never replaces what somebody is in the middle of typing", () => {
    const typing = { draft: "Survived by her daughter Ruth and", agreed: onFile };
    expect(takeServerText(typing, sisterWrote, true)).toBe(typing);
  });

  it("keeps an unsaved edit even once the cursor has left the box", () => {
    // Typed, tabbed away, and the save has not come back (or failed).
    const pending = { draft: "Survived by her daughter Ruth and her grandson", agreed: onFile };
    expect(takeServerText(pending, sisterWrote, false)).toBe(pending);
  });

  it("agrees with the server once the save lands", () => {
    const saved = "Survived by her daughter Ruth and her grandson";
    const pending = { draft: saved, agreed: onFile };
    expect(takeServerText(pending, saved, false)).toEqual({ draft: saved, agreed: saved });
    // Even if the box still has focus: nothing is lost by agreeing.
    expect(takeServerText(pending, saved, true)).toEqual({ draft: saved, agreed: saved });
  });

  it("takes an emptied field from the server too", () => {
    const field = { draft: onFile, agreed: onFile };
    expect(takeServerText(field, "", false)).toEqual({ draft: "", agreed: "" });
  });
});
