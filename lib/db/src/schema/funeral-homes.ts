import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { homeGroupsTable } from "./home-groups";

/**
 * How long after the service the case chat stays open, for a home that has
 * never thought about it. Two weeks is long enough to settle the things that
 * surface after a funeral and short enough that the promise to end the
 * endless thread stays true; a home that disagrees changes its own column.
 */
export const DEFAULT_MESSAGE_LOCK_DAYS = 14;

/**
 * How many photographs a home asks a family to pick for the slideshow, when
 * it has not said. Roughly what a watchable slideshow holds.
 */
export const DEFAULT_SLIDESHOW_TARGET = 50;

/**
 * A funeral home. The tenant, and the thing that pays the monthly bill.
 *
 * Every other table in this database is reachable from a row here, and every
 * query in the API filters on `funeralHomeId` before it filters on anything
 * else. That is the whole security model: one home must never see another
 * home's families, and the way that is guaranteed is that the tenant id comes
 * from the signed-in staff member's row — never from the request.
 *
 * The branding columns are not decoration. The pitch to a director is that
 * the family experience looks like it came from *their* home, and that the
 * grief aftercare arrives signed "provided in care with Horan & McConaty".
 * A logo and an accent colour are what make that true.
 */
export const funeralHomesTable = pgTable(
  "funeral_homes",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * Used in the family-facing URL and in the aftercare sender name. Stored
     * lower-cased and unique so it can be relied on as an identifier.
     */
    slug: text("slug").notNull(),

    /* ------------------------------------------------------------ brand */

    logoUploadId: integer("logo_upload_id"),
    /** Hex, e.g. "#1f4e46". Rendered into the family portal's header. */
    accentColor: text("accent_color").notNull().default("#1f4e46"),

    /* ------------------------------------------------- contact + hours */

    phone: text("phone"),
    /**
     * The number a family is told to ring when it genuinely cannot wait —
     * a death in the night, a removal. Kept separate from `phone` because
     * the whole point of office hours is to route non-urgent questions away
     * from the director's cell phone and urgent ones straight to a human.
     */
    urgentPhone: text("urgent_phone"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),

    /**
     * Office hours, as minutes from midnight in `timezone`. Minutes rather
     * than a time column because the only arithmetic ever done with them is
     * "is now inside the window", and integers make that a comparison rather
     * than a date-library problem.
     *
     * These do not gate anything. A family can write a message at 2am and it
     * will be delivered; what changes is that the portal tells them plainly
     * when it will be read, and offers the urgent line if it cannot wait.
     * Silently holding a message would be worse than the midnight text this
     * feature exists to prevent.
     */
    officeOpensMinute: integer("office_opens_minute").notNull().default(8 * 60),
    officeClosesMinute: integer("office_closes_minute")
      .notNull()
      .default(17 * 60),
    timezone: text("timezone").notNull().default("America/Denver"),

    /* ------------------------------------------------------- aftercare */

    /**
     * Whether closing a case hands the family on to the grief aftercare.
     * On by default: it is the feature that costs the home nothing and makes
     * them look most thoughtful, and a home that does not want it can say so.
     */
    aftercareEnabled: boolean("aftercare_enabled").notNull().default(true),
    /**
     * How the aftercare signs itself. Defaults to the home's name at send
     * time when blank — held separately because "Horan & McConaty Funeral
     * Service" is a legal name and "Horan & McConaty" is what a grieving
     * family should read at the bottom of a check-in.
     */
    aftercareSenderName: text("aftercare_sender_name"),

    /* ---------------------------------------------------- the front door */

    /**
     * Whether the home's public page will take a request from someone nobody
     * has sent a link to — a family who found the website at 2am, or someone
     * arranging their own funeral in advance.
     *
     * On by default, because a home that has never heard of the feature is
     * better served by a request sitting in their queue than by a bereaved
     * family hitting a dead end. Off is a real answer for a home that would
     * rather every first contact be a phone call, and the public page then
     * says so and gives the number instead of a form.
     */
    intakeEnabled: boolean("intake_enabled").notNull().default(true),
    /**
     * Where a request lands. Falls back to the owner's address at send time.
     * A form that quietly fills a queue nobody opens is worse than no form:
     * the family believes they have reached someone.
     */
    intakeNotifyEmail: text("intake_notify_email"),

    /* ------------------------------------------------------- the storefront */

    /**
     * The two paragraphs on the home's public page, above the form.
     *
     * Not marketing copy, and the editor says so. The page is reached by
     * somebody whose mother died an hour ago, and what they need off it is
     * that they have the right place and that a person will answer. A
     * headline that says "Serving Jefferson County since 1946" does that; a
     * headline that says "Compassionate care for your loved ones" does not,
     * because every home says it.
     *
     * Null on both is a perfectly good state -- the page already shows the
     * name, the address and the telephone number, which is the part that
     * matters. Nothing here is required before a home can take a request.
     */
    storefrontHeadline: text("storefront_headline"),
    storefrontAbout: text("storefront_about"),

    /* ------------------------------------------------- the operational rules */

    /**
     * How long the case chat stays open after the service, in days.
     *
     * Per home rather than the constant it replaces, because the right
     * number is a matter of how a home works. Fourteen days suits a home
     * that closes a file and moves on; a small-town home whose families are
     * also its neighbours wants longer, and being unable to say so meant
     * choosing between a promise the product could not keep and a door that
     * shut on people too early.
     *
     * Applied when a case closes, and read from this column at that moment
     * rather than continuously: a home that shortens this must not retro-
     * actively slam a conversation shut on a family mid-sentence.
     */
    messageLockDays: integer("message_lock_days")
      .notNull()
      .default(DEFAULT_MESSAGE_LOCK_DAYS),

    /**
     * How many photographs the home asks a family to pick for the slideshow.
     *
     * Shown as a target, never enforced -- a family who wants sixty for
     * their mother gets sixty. It is here because the number is a fact about
     * how long the home's slideshows run, and a home whose service holds a
     * ten-minute slideshow was previously being told to ask for fifty by
     * software that had never seen one of their funerals.
     */
    slideshowTarget: integer("slideshow_target")
      .notNull()
      .default(DEFAULT_SLIDESHOW_TARGET),

    /* ---------------------------------------------------- subscription */

    /**
     * Deliberately coarse. Billing lives in Stripe; this column only answers
     * the question the app actually asks, which is whether to let this home
     * open new cases. Anything finer would be a second source of truth for
     * money, and it would be the wrong one.
     */
    subscriptionStatus: text("subscription_status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at"),

    /**
     * Stripe's ids, so the two systems can find each other again.
     *
     * Money lives in Stripe. What is kept here is only what the app needs to
     * answer its own question -- may this home open another case -- plus
     * enough to send somebody to their billing page. Prices, invoices, cards
     * and proration are deliberately absent: a second source of truth for
     * money is always the wrong one.
     */
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** When the paid period ends. Set from Stripe, never calculated here. */
    currentPeriodEndsAt: timestamp("current_period_ends_at"),

    /**
     * Which add-ons this home is entitled to, as a comma-separated list of
     * keys. Same shape as `onboardingDone` above, and for the same reason:
     * the set will change as the product does, and a boolean column per
     * add-on is the sort of friction that stops anyone adding one.
     *
     * Written by the Stripe webhook from the subscription's line items, so
     * this is a cache of what was bought rather than a second opinion about
     * it. Note what is still absent: no price, no amount, no quantity. What
     * was paid stays in Stripe. See `plans.ts`.
     */
    entitlements: text("entitlements").notNull().default(""),

    /**
     * The group this location belongs to, if it belongs to one.
     *
     * Null is the ordinary case -- a single home that pays its own bill.
     * When it is set, the group's subscription is the one that counts, and
     * the webhook writes the group's status and entitlements down onto this
     * row. Nothing at request time joins to the group, which is deliberate:
     * see `home-groups.ts`.
     *
     * `set null` on delete, emphatically. A group row is a billing
     * arrangement; removing one must release forty funeral homes, never
     * cascade into deleting them.
     */
    groupId: integer("group_id").references(() => homeGroupsTable.id, {
      onDelete: "set null",
    }),

    /**
     * Which setup steps the home has finished.
     *
     * A comma-separated list rather than a column each, because these are a
     * checklist that will change as the product does, and migrating a boolean
     * every time somebody adds a step is the sort of friction that stops
     * anyone adding one.
     */
    onboardingDone: text("onboarding_done").notNull().default(""),

    /**
     * Set when the platform suspends this home. Component 2's doing, and the
     * only destructive thing the admin console can do.
     *
     * A separate column from `subscriptionStatus` rather than another status
     * value, because they answer different questions and both answers are
     * needed: Stripe owns whether the bill is paid, and a person at the
     * platform owns whether this account should be running at all. Collapsing
     * them would mean a webhook from Stripe could silently un-suspend a home
     * somebody suspended on purpose.
     *
     * Suspension stops new cases. It deliberately does not delete anything,
     * lock the home out of its own console, or cut a family off part-way
     * through uploading photographs of their mother.
     */
    suspendedAt: timestamp("suspended_at"),
    /** Why, in the platform's own words. Never shown to the home's families. */
    suspendedReason: text("suspended_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("funeral_homes_slug_unique").on(table.slug)],
);

/** How long a home gets to try it with real families. */
export const TRIAL_DAYS = 30;

/**
 * The setup steps a home is walked through.
 *
 * Ordered by what unblocks the most: a home that has done nothing else should
 * still be able to open a case and text a family, so branding and hours come
 * after the first real use rather than before it. Nothing here is enforced --
 * a director who ignores the list entirely still has a working product.
 */
export const ONBOARDING_STEPS = [
  {
    key: "case",
    title: "Open your first case",
    detail: "Just a name. Everything else can wait until you know it.",
  },
  {
    key: "family",
    title: "Send a family their link",
    detail: "This is the part families notice. Text it from the case.",
  },
  {
    key: "branding",
    title: "Add your name and colour",
    detail: "So the portal looks like it came from you, not from us.",
  },
  {
    key: "hours",
    title: "Set your office hours and 24-hour number",
    detail: "What families are told about when you'll read a message.",
  },
  {
    key: "schedule",
    title: "Check your standard schedule",
    detail: "Every case gets it automatically once there's a service date.",
  },
  {
    key: "staff",
    title: "Invite your colleagues",
    detail: "They set their own passwords.",
  },
  {
    key: "public",
    title: "Put your page on your website",
    detail:
      "So a family who has just had a death can reach you at 2am. This ticks itself the first time somebody uses it.",
  },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["key"];

export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Whether this home may still open cases.
 *
 * `past_due` deliberately still works. A card that expired is an
 * administrative problem, and locking a funeral home out of the case they are
 * working on Thursday because of it would be a disgrace — Stripe will chase
 * the payment, and `canceled` is the state that actually stops new cases.
 * Even then, existing cases stay reachable: a family part-way through
 * uploading photographs of their mother must not lose access because the home
 * changed billing plans.
 */
export function canOpenCases(home: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  suspendedAt?: Date | null;
}, now = new Date()): boolean {
  // Checked before the subscription, because a suspended home is suspended
  // whatever Stripe thinks of it.
  if (home.suspendedAt != null) return false;

  if (home.subscriptionStatus === "active") return true;
  if (home.subscriptionStatus === "past_due") return true;
  if (home.subscriptionStatus === "canceled") return false;

  // On trial: until it runs out.
  return home.trialEndsAt === null || home.trialEndsAt > now;
}

/**
 * What to tell a director whose home cannot open a new case.
 *
 * Lives beside `canOpenCases` because the two answers must never disagree,
 * and because the wrong sentence here is a real cost: a home that has been
 * suspended by the platform, told to "start a subscription", rings support
 * about a card that was never the problem. Every branch says what happened,
 * what still works, and who can undo it.
 */
export function cannotOpenCasesReason(home: {
  subscriptionStatus: string;
  suspendedAt?: Date | null;
}): string {
  if (home.suspendedAt != null) {
    return (
      "This account has been suspended. Everything already here stays " +
      "available to you and to your families; please get in touch and we " +
      "will sort it out."
    );
  }

  return home.subscriptionStatus === "trial"
    ? "Your trial has finished. Start a subscription to open new cases — everything already here stays available."
    : "This subscription has ended. Existing cases stay available; start a subscription to open new ones.";
}

/** Days left on a trial, floored at zero. Null when not on one. */
export function trialDaysLeft(home: {
  subscriptionStatus: string;
  trialEndsAt: Date | null;
}, now = new Date()): number | null {
  if (home.subscriptionStatus !== "trial" || home.trialEndsAt === null) {
    return null;
  }

  const ms = home.trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export const insertFuneralHomeSchema = createInsertSchema(
  funeralHomesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFuneralHome = z.infer<typeof insertFuneralHomeSchema>;
export type FuneralHome = typeof funeralHomesTable.$inferSelect;

/**
 * What a family is allowed to know about the home whose portal they are in:
 * enough to recognise it and to reach it, and nothing about its account.
 */
export type PublicFuneralHome = Pick<
  FuneralHome,
  | "name"
  | "slug"
  | "accentColor"
  | "logoUploadId"
  | "phone"
  | "urgentPhone"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "region"
  | "postalCode"
  | "intakeEnabled"
  | "officeOpensMinute"
  | "officeClosesMinute"
  | "timezone"
  | "storefrontHeadline"
  | "storefrontAbout"
>;

export function toPublicFuneralHome(home: FuneralHome): PublicFuneralHome {
  return {
    name: home.name,
    slug: home.slug,
    accentColor: home.accentColor,
    logoUploadId: home.logoUploadId,
    phone: home.phone,
    urgentPhone: home.urgentPhone,
    // Enough for someone who found this page by searching to be sure it is
    // the home they mean, before they type anything about a death into it.
    addressLine1: home.addressLine1,
    addressLine2: home.addressLine2,
    city: home.city,
    region: home.region,
    postalCode: home.postalCode,
    intakeEnabled: home.intakeEnabled,
    officeOpensMinute: home.officeOpensMinute,
    officeClosesMinute: home.officeClosesMinute,
    timezone: home.timezone,
    // The home's own words about itself. Note what is *not* here, and see
    // `price-list.ts` for why: the home's prices are staff-only, and this
    // function is the one place where forgetting that would publish them.
    storefrontHeadline: home.storefrontHeadline,
    storefrontAbout: home.storefrontAbout,
  };
}
