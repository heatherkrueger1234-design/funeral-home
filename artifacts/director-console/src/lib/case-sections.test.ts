import { describe, expect, it } from "vitest";
import { SECTIONS, TABS, TAB_LABELS } from "./case-sections";

describe("case page sections", () => {
  it("puts every tab in exactly one section, with a label", () => {
    const placed = SECTIONS.flatMap((section) => section.tabs);
    expect([...placed].sort()).toEqual([...TABS].sort());
    for (const tab of TABS) expect(TAB_LABELS[tab]).toBeTruthy();
  });

  it("keeps each section short enough to read at a glance", () => {
    expect(SECTIONS).toHaveLength(4);
    for (const section of SECTIONS) expect(section.tabs.length).toBeLessThanOrEqual(5);
  });
});
