/**
 * Create the Stripe catalogue from `lib/db/src/price-book.ts`, once.
 *
 *   pnpm --filter @workspace/scripts run stripe-setup            # dry run
 *   pnpm --filter @workspace/scripts run stripe-setup -- --apply
 *
 * Without STRIPE_SECRET_KEY it prints the plan and exits cleanly: Stripe not
 * being live must never break anything. Metered prices need the funeral
 * meter's id in STRIPE_CASE_METER_ID (create the meter in the dashboard with
 * the event name you put in STRIPE_CASE_METER_EVENT).
 */
import { planCatalogue, type ExistingPrice } from "./lib/stripe-plan";

const key = process.env["STRIPE_SECRET_KEY"]?.trim();
const apply = process.argv.includes("--apply");

async function stripe<T>(path: string, form?: Record<string, string>): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? `Stripe refused (${response.status})`);
  return body;
}

async function main() {
  let existing: ExistingPrice[] = [];
  if (key) {
    const lookup = new URLSearchParams();
    for (const step of planCatalogue([])) lookup.append("lookup_keys[]", step.lookupKey);
    existing = (await stripe<{ data: ExistingPrice[] }>(`/prices?${lookup}`)).data;
  } else {
    console.log("STRIPE_SECRET_KEY is not set: showing the plan only.\n");
  }

  const meter = process.env["STRIPE_CASE_METER_ID"]?.trim();
  for (const step of planCatalogue(existing)) {
    if (step.action === "exists") {
      console.log(`${step.env}=${step.priceId}   # ${step.lookupKey}, already in Stripe`);
      continue;
    }
    const form = { ...step.form };
    if (form["recurring[meter]"]) {
      if (!meter) {
        console.log(`# ${step.lookupKey}: set STRIPE_CASE_METER_ID first (metered)`);
        continue;
      }
      form["recurring[meter]"] = meter;
    }
    if (!key || !apply) {
      console.log(`# would create ${step.lookupKey} (${form["unit_amount"]}¢ / ${form["recurring[interval]"]}) -> ${step.env}`);
      continue;
    }
    const created = await stripe<{ id: string }>("/prices", form);
    console.log(`${step.env}=${created.id}   # ${step.lookupKey}, created`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
