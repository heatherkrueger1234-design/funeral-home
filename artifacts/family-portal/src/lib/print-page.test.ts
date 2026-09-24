import { describe, expect, it } from "vitest";
import { pageWidthOf } from "./print-page";

describe("pageWidthOf", () => {
  it("reads a template's width in inches as CSS pixels", () => {
    expect(pageWidthOf("<style>@page { size: 5.75in 8.75in; margin: 0; }</style>")).toBe(552);
  });

  it("understands millimetres", () => {
    expect(pageWidthOf("@page{size:210mm 297mm}")).toBeCloseTo(793.7, 1);
  });

  it("says nothing rather than guessing when there is no page size", () => {
    expect(pageWidthOf("<p>no page rule</p>")).toBeNull();
    expect(pageWidthOf("@page { margin: 0 }")).toBeNull();
  });
});
