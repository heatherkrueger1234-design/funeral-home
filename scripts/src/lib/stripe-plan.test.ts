import { test } from "node:test";
import assert from "node:assert/strict";
import { PRICE_BOOK, locationAnnualCents, monthlyCostDollars } from "@workspace/db/price-book";
import { planCatalogue } from "./stripe-plan";

test("prices are $169 a location, $7 a funeral, annual is two months free", () => {
  assert.equal(PRICE_BOOK.locationMonthlyCents, 16_900);
  assert.equal(PRICE_BOOK.perFuneralCents, 700);
  assert.equal(PRICE_BOOK.activationFeeCents, 0);
  assert.equal(locationAnnualCents, 169_000);
  assert.equal(PRICE_BOOK.trialDays, 30);
});

test("the unit economics PRICING.md quotes", () => {
  const typical = monthlyCostDollars(10, 10);
  assert.equal(typical.revenue, 239);
  assert.equal(Math.round(typical.total * 100) / 100, 68.9);
  assert.ok(typical.margin > 0.71 && typical.margin < 0.72);
  // From about sixteen homes, every size of home clears 70%, even one funeral a month.
  for (let funerals = 1; funerals <= 60; funerals += 1) {
    assert.ok(monthlyCostDollars(funerals, 16).margin >= 0.7, `${funerals} funerals`);
  }
});

test("creates only what Stripe does not already have", () => {
  const first = planCatalogue([]);
  assert.equal(first.length, 4);
  assert.ok(first.every((step) => step.action === "create"));
  const again = planCatalogue([{ id: "price_1", lookup_key: "continuum_location_monthly" }]);
  assert.deepEqual(
    again.map((step) => step.action),
    ["exists", "create", "create", "create"],
  );
  const metered = first.find((step) => step.lookupKey === "continuum_funeral_served");
  assert.ok(metered && metered.action === "create");
  assert.equal(metered.form["recurring[usage_type]"], "metered");
});
