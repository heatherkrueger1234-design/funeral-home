import { STRIPE_CATALOGUE } from "@workspace/db/price-book";

/**
 * What `stripe-setup` would do: create each price in the catalogue that
 * Stripe does not already have under its lookup key, and name the env var
 * each one belongs in. Pure, so it is tested without Stripe.
 */
export type ExistingPrice = { id: string; lookup_key: string | null };

export type PlanStep =
  | { action: "exists"; lookupKey: string; env: string; priceId: string }
  | { action: "create"; lookupKey: string; env: string; form: Record<string, string> };

export function planCatalogue(existing: ExistingPrice[]): PlanStep[] {
  return STRIPE_CATALOGUE.map((entry) => {
    const found = existing.find((price) => price.lookup_key === entry.lookupKey);
    if (found) {
      return { action: "exists", lookupKey: entry.lookupKey, env: entry.env, priceId: found.id };
    }
    const form: Record<string, string> = {
      currency: "usd",
      unit_amount: String(entry.unitAmount),
      lookup_key: entry.lookupKey,
      "product_data[name]": entry.product,
      "recurring[interval]": entry.interval,
      "recurring[usage_type]": entry.usage,
    };
    if (entry.usage === "metered") {
      // Metered prices bill from the meter the usage reporter writes to.
      form["recurring[meter]"] = "{{STRIPE_CASE_METER_ID}}";
    }
    return { action: "create", lookupKey: entry.lookupKey, env: entry.env, form };
  });
}
