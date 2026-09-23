import {
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A group of funeral homes under one owner, and one contract.
 *
 * The market this product sells into is consolidating. A handful of groups
 * own dozens of locations each, and those locations were bought precisely
 * because a family in that town has trusted that name for eighty years — so
 * the sign over the door stays, the letterhead stays, and the director the
 * family rings is the same person. What is shared is the back office.
 *
 * That shape is the whole reason this table exists, and it decides what the
 * table does and does not do:
 *
 *   - It carries **billing**. One Stripe customer, one subscription, one
 *     invoice for forty locations, which is the only way a group will buy
 *     anything. Selling a rollup one seat at a time is forty conversations
 *     to close the revenue of one.
 *   - It carries **entitlements**, so the add-ons are bought once for the
 *     estate rather than argued about per location.
 *   - It deliberately carries **no branding**. The obvious feature here is
 *     for the group's logo and colour to flow down into every location's
 *     family portal, and it would be exactly wrong: it would take the local
 *     name off the page a bereaved family in that town actually sees, which
 *     is the asset the group paid for. Locations keep their own brand. If a
 *     group ever wants one look across the estate, they can set it per
 *     location, on purpose, and see what they are doing.
 *   - It deliberately grants **no visibility across locations**. Membership
 *     here is a billing relationship and nothing else. Every query in this
 *     API still filters on `funeralHomeId` read off the signed-in user's own
 *     row, and no group session exists that could widen that. Cross-location
 *     reporting is a real thing a group will ask for, and it is the same
 *     cross-tenant read the platform console does — audit log and all — so
 *     it gets built deliberately, when somebody asks, and not by quietly
 *     loosening the one predicate the whole security model rests on.
 */
export const homeGroupsTable = pgTable(
  "home_groups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** Lower-cased and unique, the same contract as a home's slug. */
    slug: text("slug").notNull(),

    /* ---------------------------------------------------- subscription */

    /**
     * The same four coarse states a home has, and for the same reason: this
     * column answers whether the locations may open cases, and nothing
     * finer. Money lives in Stripe.
     *
     * When a home belongs to a group, this is the status that counts. It is
     * not read at request time, though -- see `funeral-homes.ts`. The
     * webhook writes the group's status down onto every member home, so
     * that `canOpenCases` stays one function reading one row. A gate that
     * sometimes had to remember to join a second table is a gate that will
     * eventually forget.
     */
    subscriptionStatus: text("subscription_status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at"),

    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEndsAt: timestamp("current_period_ends_at"),

    /**
     * When the most recently *applied* webhook event was created, per Stripe
     * (`event.created`). The same guard `funeral_homes` carries, and it
     * matters more here: Stripe does not guarantee delivery order, so a
     * `subscription.updated` queued before a later `subscription.deleted`
     * can arrive after it. On a single home that stale event silently
     * re-activates one account. On a group it re-activates **every location
     * under the contract**, because the answer is written down onto all of
     * them. An incoming event older than this is ignored.
     */
    stripeEventCreatedAt: timestamp("stripe_event_created_at"),

    /**
     * Which add-ons the contract covers, as a comma-separated list of keys.
     * Bought once for the estate and fanned out to the locations by the
     * webhook, in the same movement as the status above.
     */
    entitlements: text("entitlements").notNull().default(""),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("home_groups_slug_unique").on(table.slug)],
);

export const insertHomeGroupSchema = createInsertSchema(homeGroupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertHomeGroup = z.infer<typeof insertHomeGroupSchema>;
export type HomeGroup = typeof homeGroupsTable.$inferSelect;
