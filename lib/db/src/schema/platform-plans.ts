import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The subscription plans Heather sells, with their prices.
 *
 * The spec asks for a plan select on the home-onboarding template with
 * amounts configurable in settings ("monthly / annual — amounts
 * configurable in settings"). The `funeral_homes` row records which plan a
 * home was sold (`subscriptionPlan`, the plan's name), which of its prices
 * they pay (`billingPeriod`, "monthly" or "annual"), and the amount actually
 * agreed (`billingAmountCents`, prefilled from the plan but editable —
 * every deal has its own handshake). This table is the price list those
 * fields are chosen from, kept current from the console's Plans page.
 *
 * Money that *gates* anything still lives in Stripe (`subscriptionStatus` on
 * the home). This table is the commercial record of what was offered — the
 * price list on Heather's side of the desk.
 */
export const platformPlansTable = pgTable(
  "platform_plans",
  {
    id: serial("id").primaryKey(),
    /** e.g. "Standard". Shown in the onboarding plan select. */
    name: text("name").notNull(),
    /** Price per month, in cents, e.g. 9900 = $99. */
    monthlyAmountCents: integer("monthly_amount_cents").notNull().default(0),
    /** Price per year, in cents, e.g. 99000 = $990. */
    annualAmountCents: integer("annual_amount_cents").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_plans_name_key").on(table.name)],
);

export type PlatformPlan = typeof platformPlansTable.$inferSelect;
