import { describe, expect, it } from "vitest";
import { homeIsInColorado } from "./home-state";

describe("which homes get Colorado's wording", () => {
  it("reads the state field the way the server does", () => {
    for (const typed of ["CO", "co", "Colorado", " colorado ", "", null, undefined]) {
      expect(homeIsInColorado(typed)).toBe(true);
    }
  });

  it("believes a home that says it is somewhere else", () => {
    for (const typed of ["WY", "Wyoming", "Texas", "nm"]) {
      expect(homeIsInColorado(typed)).toBe(false);
    }
  });
});
