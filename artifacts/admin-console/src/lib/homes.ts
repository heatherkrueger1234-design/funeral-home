import { toDollars, type HomeStatus, type PlatformPlan } from "@/lib/api";

/** Twenty-five to a page: a page and a search box, not a longer page. */
export const HOMES_PAGE_SIZE = 25;

/**
 * The orders the homes list can be put in, as its select offers them. Each
 * value packs the column and the direction together, so the select stays one
 * control; the empty value is the API's own order, by name.
 */
export const HOME_SORTS = [
  { value: "", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "plan-asc", label: "Plan (A–Z)" },
  { value: "amount-desc", label: "Amount (highest first)" },
  { value: "amount-asc", label: "Amount (lowest first)" },
  { value: "dueDate-asc", label: "Next due (soonest first)" },
  { value: "dueDate-desc", label: "Next due (latest first)" },
] as const;

export type HomesFilters = {
  /** What is in the search box, trimmed and settled. */
  term: string;
  page: number;
  status: HomeStatus | "";
  includeInternal: boolean;
  /** One of the `HOME_SORTS` values. */
  sort: string;
};

/**
 * The homes list's query string.
 *
 * Whatever has not been chosen is left out rather than sent empty: the API
 * reads an empty search as a mistake and refuses the whole request.
 */
export function homesQuery({
  term,
  page,
  status,
  includeInternal,
  sort,
}: HomesFilters): string {
  const params = new URLSearchParams({
    limit: String(HOMES_PAGE_SIZE),
    offset: String(page * HOMES_PAGE_SIZE),
  });
  if (term) params.set("search", term);
  if (status) params.set("status", status);
  if (includeInternal) params.set("includeInternal", "true");
  if (sort) {
    const [column, direction] = sort.split("-");
    params.set("sort", column!);
    params.set("order", direction!);
  }
  return params.toString();
}

/**
 * Where the pager is -- "26–50 of 60" -- and whether there is a page either
 * side of this one. Null when one page holds every home and there is no
 * pager to draw.
 */
export function pageSpan(
  page: number,
  total: number,
  showing: number,
): { first: number; last: number; previous: boolean; next: boolean } | null {
  if (total <= HOMES_PAGE_SIZE) return null;

  const first = page * HOMES_PAGE_SIZE + 1;
  const last = page * HOMES_PAGE_SIZE + showing;
  return { first, last, previous: page !== 0, next: last < total };
}

/** What the add-a-home form says about the plan before a new choice. */
export type PlanChoice = {
  planName: string;
  billingPeriod: string;
  billingAmount: string;
};

/** A plan's price at one cadence, in cents; null without a plan. */
function priceOf(
  plans: readonly PlatformPlan[],
  planName: string,
  period: string,
): number | null {
  const plan = plans.find((p) => p.name === planName);
  if (plan == null) return null;
  return period === "annual" ? plan.annualAmountCents : plan.monthlyAmountCents;
}

/**
 * The amount on the add-a-home form once a plan and a billing period are
 * chosen.
 *
 * Choosing a plan fills in its price for the chosen cadence -- a starting
 * point, not a lock. An amount still exactly as the last choice filled it in
 * follows the next one, so picking the plan and then "Annual" ends on the
 * yearly price rather than the monthly one under "Dollars per year". An
 * amount somebody has edited is left alone; clearing the field and re-picking
 * brings the price back.
 */
export function amountForPlan(
  plans: readonly PlatformPlan[],
  was: PlanChoice,
  planName: string,
  period: string,
): string {
  const filledIn = priceOf(plans, was.planName, was.billingPeriod);
  const untouched =
    was.billingAmount.trim() === "" ||
    (filledIn !== null && was.billingAmount === toDollars(filledIn));
  const price = priceOf(plans, planName, period);

  return price !== null && untouched ? toDollars(price) : was.billingAmount;
}
