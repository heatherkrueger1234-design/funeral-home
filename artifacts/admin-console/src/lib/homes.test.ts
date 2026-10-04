import { describe, expect, it } from "vitest";
import type { PlatformPlan } from "./api";
import {
  amountForPlan,
  HOME_SORTS,
  homesQuery,
  pageSpan,
  type HomesFilters,
} from "./homes";

describe("the homes list's question to the API", () => {
  const nothingChosen: HomesFilters = {
    term: "",
    page: 0,
    status: "",
    includeInternal: false,
    sort: "",
  };
  const asked = (changes: Partial<HomesFilters>) =>
    Object.fromEntries(
      new URLSearchParams(homesQuery({ ...nothingChosen, ...changes })),
    );

  it("asks for the first page and nothing else when nothing is chosen", () => {
    // An empty search is refused outright, so leaving it out is not tidiness.
    expect(asked({})).toEqual({ limit: "25", offset: "0" });
  });

  it("pages twenty-five homes at a time", () => {
    expect(asked({ page: 1 })).toEqual({ limit: "25", offset: "25" });
    expect(asked({ page: 3 })).toEqual({ limit: "25", offset: "75" });
  });

  it("sends the search, the account state and our own homes only once chosen", () => {
    expect(
      asked({ term: "Hartley", status: "past_due", includeInternal: true }),
    ).toEqual({
      limit: "25",
      offset: "0",
      search: "Hartley",
      status: "past_due",
      includeInternal: "true",
    });
  });

  it("keeps a name with an ampersand in it as one search", () => {
    expect(asked({ term: "Horan & McConaty" }).search).toBe("Horan & McConaty");
  });

  it("splits a packed sort into the column and the direction", () => {
    expect(asked({ sort: "amount-desc" })).toMatchObject({
      sort: "amount",
      order: "desc",
    });
    expect(asked({ sort: "dueDate-asc" })).toMatchObject({
      sort: "dueDate",
      order: "asc",
    });
  });

  it("offers only orders the API knows how to sort by", () => {
    // `ListHomesQuery` in api-server/src/routes/admin.ts. Anything else is a
    // refused request, and the list shows an error instead of homes.
    for (const { value } of HOME_SORTS) {
      const { sort, order } = asked({ sort: value });
      if (value === "") {
        expect(sort).toBeUndefined();
      } else {
        expect(["name", "plan", "amount", "dueDate"]).toContain(sort);
        expect(["asc", "desc"]).toContain(order);
      }
    }
  });
});

describe("the pager under the homes list", () => {
  it("is not drawn when one page holds every home", () => {
    expect(pageSpan(0, 25, 25)).toBeNull();
    expect(pageSpan(0, 3, 3)).toBeNull();
  });

  it("says which homes are showing, and stops at either end", () => {
    expect(pageSpan(0, 60, 25)).toEqual({
      first: 1,
      last: 25,
      previous: false,
      next: true,
    });
    expect(pageSpan(1, 60, 25)).toEqual({
      first: 26,
      last: 50,
      previous: true,
      next: true,
    });
    expect(pageSpan(2, 60, 10)).toEqual({
      first: 51,
      last: 60,
      previous: true,
      next: false,
    });
    // A last page that happens to be full is still the last page.
    expect(pageSpan(1, 50, 25)).toMatchObject({ last: 50, next: false });
  });
});

describe("choosing a plan on the add-a-home form", () => {
  const plans: PlatformPlan[] = [
    { id: 1, name: "Standard", monthlyAmountCents: 4900, annualAmountCents: 49000 },
    { id: 2, name: "Plus", monthlyAmountCents: 7999, annualAmountCents: 79990 },
  ];

  it("fills an empty amount with the plan's price at the chosen cadence", () => {
    expect(amountForPlan(plans, "Standard", "monthly", "")).toBe("49");
    expect(amountForPlan(plans, "Plus", "monthly", "  ")).toBe("79.99");
    expect(amountForPlan(plans, "Plus", "annual", "")).toBe("799.9");
  });

  it("leaves an amount somebody typed alone, whatever is chosen after it", () => {
    // Every deal has its own handshake; the price list is a starting point.
    expect(amountForPlan(plans, "Standard", "annual", "450")).toBe("450");
    expect(amountForPlan(plans, "Plus", "monthly", "60")).toBe("60");
  });

  it("fills nothing in without a plan, or for one taken off the price list", () => {
    expect(amountForPlan(plans, "", "monthly", "")).toBe("");
    expect(amountForPlan(plans, "Founding", "monthly", "")).toBe("");
  });
});
