import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { funeralHomesTable } from "./funeral-homes";

/**
 * What we charge a funeral home for, and what we refuse to charge anyone for.
 *
 * Read the second half of this comment before adding anything to this file.
 *
 * ## The shape of the price
 *
 * A base subscription per location, an add-on or two, and a per-case charge
 * on top. Volume pays more, which is how this category prices and what a
 * small home with nine funerals a year needs in order to afford it at all.
 *
 * The rule this file keeps is the same rule `billing.ts` keeps: **we store no
 * prices.** Not the base rate, not the per-case rate, not a currency. What is
 * stored here is a *count of funerals served* and a set of *entitlement keys*.
 * Stripe turns those into money. A second source of truth for money is always
 * the wrong one, and the version of it that quietly disagrees with the invoice
 * is the worst thing a vendor can hand a customer's bookkeeper.
 *
 * ## Who pays
 *
 * The funeral home pays. Not the family.
 *
 * That is a line, not an oversight, and it has been tested from the other
 * side: the obvious next revenue idea is to sell the obituary or the
 * photograph slideshow to the family as a keepsake, since the software has
 * already produced both and the family is right there with a card in hand.
 *
 * It is not built and it should not be, for four separate reasons any one of
 * which is sufficient:
 *
 *   1. It puts us back in the money business we deliberately left. The
 *      product processes no payments, holds no funds and stores no card
 *      details, and `COLORADO.md` Section 4 lists what that buys: no money
 *      transmission question in any state, no PCI scope, no chargebacks, and
 *      no connected-account onboarding standing between a home and its first
 *      day of use. A family-facing charge re-imports all four to sell a PDF.
 *   2. The charge would appear inside the home's own branded portal, for
 *      something connected to a funeral, without appearing on the home's
 *      General Price List or on the Statement of Funeral Goods and Services
 *      Selected. The Funeral Rule binds the *provider* -- the home. We would
 *      be generating a compliance problem and handing it to the customer.
 *   3. C.R.S. 6-1-101: no fee appears after a total is shown, and the number
 *      the family sees first is the number they pay. A keepsake upsell during
 *      an arrangement is the exact practice that section describes.
 *   4. The slideshow is assembled out of photographs the family themselves
 *      uploaded of their own mother. Charging them to get it back is not an
 *      upsell, it is a toll on their own belongings, and the complaint goes
 *      to the director whose name is at the top of the page -- not to us.
 *
 * So the obituary and the photograph pack stay free to the family, for ever,
 * including after the home has cancelled. `no-family-charges.test.ts` fails
 * the build if that ever stops being true.
 *
 * If a home wants to charge for a keepsake, it already can, the correct way:
 * as a line on its own price list, on its own statement, through its own
 * processor. That is its sale to make, with its disclosures attached.
 */

/* ------------------------------------------------------------- add-ons -- */

/**
 * The add-ons a home or a group can buy on top of the base subscription.
 *
 * Keys are stable and stored; titles are shown. Adding one means adding a
 * Stripe price and mapping it in `billing.ts` -- the key never comes from
 * Stripe's own naming, so a price renamed in the dashboard cannot silently
 * turn an entitlement off.
 */
export const ADD_ONS = [
  {
    key: "aftercare",
    title: "Grief aftercare",
    detail:
      "Closing a case enrols the family, with their consent, in check-ins " +
      "at thirty, sixty and ninety days and on the anniversary — every one " +
      "of them signed in your name, and none of them costing you staff time.",
  },
] as const;

export type AddOnKey = (typeof ADD_ONS)[number]["key"];

export function isAddOnKey(value: string): value is AddOnKey {
  return ADD_ONS.some((addOn) => addOn.key === value);
}

/** The stored comma-separated list, as a set. */
export function parseEntitlements(stored: string): Set<string> {
  return new Set(
    stored
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function serialiseEntitlements(keys: Iterable<string>): string {
  return [...new Set(keys)].filter(isAddOnKey).sort().join(",");
}

/**
 * Whether this home may use an add-on.
 *
 * A live trial includes everything. That is a deliberate commercial choice
 * and worth stating: aftercare is the feature that sells the product, and a
 * director who never sees a check-in go out in their own name during the
 * thirty days has not been shown the thing they would be buying.
 *
 * Read from the home's own row even when the home belongs to a group, for
 * the reason given in `home-groups.ts`: the webhook fans the group's
 * entitlements down onto its locations, so there is one row to read here and
 * no join to forget.
 */
export function hasAddOn(
  home: {
    subscriptionStatus: string;
    trialEndsAt: Date | null;
    entitlements: string;
  },
  key: AddOnKey,
  now = new Date(),
): boolean {
  if (
    home.subscriptionStatus === "trial" &&
    (home.trialEndsAt === null || home.trialEndsAt > now)
  ) {
    return true;
  }

  return parseEntitlements(home.entitlements).has(key);
}

/* ------------------------------------------------------ the case meter -- */

/**
 * One row per funeral this home was charged for. The meter, and the receipt
 * for it.
 *
 * Three properties matter, and each one is a decision:
 *
 * **A case is counted once, ever.** `billable_cases_case_unique` is what
 * guarantees it, at the database rather than in the code that writes here. A
 * home billed twice for burying the same person is not a rounding error to
 * them, it is evidence that the vendor does not know what it is doing.
 *
 * **Counting is local; reporting is a separate, later step.** The row is
 * written when the case opens and `reportedAt` is set when Stripe has
 * accepted it, by the scheduled job in `metering.ts`. Nothing calls Stripe
 * while a director is opening a case. A funeral home at eight in the morning
 * with a family on the way in must never be waiting on api.stripe.com, and
 * must never be *refused* by it.
 *
 * **It outlives the case.** `caseId` is a plain integer and not a foreign
 * key, which is the one place in this schema that rule is broken and it is
 * broken on purpose: erasing a case at a family's request must not reach
 * back and rewrite what we invoiced the home three months ago. The row holds
 * no name, no contact and nothing about the deceased -- a case id, a home id
 * and two timestamps -- so there is nothing in it that erasure is for.
 */
export const billableCasesTable = pgTable(
  "billable_cases",
  {
    id: serial("id").primaryKey(),
    funeralHomeId: integer("funeral_home_id")
      .notNull()
      .references(() => funeralHomesTable.id, { onDelete: "cascade" }),

    /** Deliberately not a foreign key. See the note above. */
    caseId: integer("case_id").notNull(),

    /** When the funeral was taken on. The date the charge belongs to. */
    countedAt: timestamp("counted_at").notNull().defaultNow(),

    /**
     * Set when this case is counted but not chargeable, with the reason in
     * the home's language: `trial` while they are still trying it.
     *
     * A waived row is still written rather than skipped, so that "how many
     * funerals did we handle in here" and "how many did you bill us for" are
     * both answerable from the same table, and the difference is visible
     * instead of being an absence nobody can audit.
     */
    waivedReason: text("waived_reason"),

    /** When Stripe accepted the meter event. Null until the job runs. */
    reportedAt: timestamp("reported_at"),
    /** Set when reporting failed, so it is a visible state and not a silence. */
    failedAt: timestamp("failed_at"),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("billable_cases_case_unique").on(table.caseId),
    index("billable_cases_unreported_idx").on(table.reportedAt, table.countedAt),
    index("billable_cases_home_idx").on(table.funeralHomeId, table.countedAt),
  ],
);

export type BillableCase = typeof billableCasesTable.$inferSelect;
