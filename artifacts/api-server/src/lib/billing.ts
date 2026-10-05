import { count, eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  homeGroupsTable,
  freeTrialDays,
  hasLiveSubscription,
  serialiseEntitlements,
  type AddOnKey,
  type FuneralHome,
  type HomeGroup,
} from "@workspace/db";
import { advisoryLockOnText, LOCKS } from "./advisory-lock";
import { HttpError } from "./http";
import { logger } from "./logger";

/**
 * Money, kept in Stripe.
 *
 * What this file does is small on purpose: send a home to Stripe's own
 * checkout and billing pages, and listen for the handful of events that
 * change whether the app should let them open another case. Prices, cards,
 * invoices, proration, tax and dunning all stay on Stripe's side, where they
 * are somebody else's correctness problem and where the receipts a funeral
 * home's accountant asks for already exist.
 *
 * Called over `fetch` rather than through the SDK. The surface used here is
 * a few form-encoded POSTs and two GETs, the SDK is a large dependency, and
 * keeping the calls visible makes it obvious exactly what leaves this
 * process.
 *
 * With no key configured every function reports that billing is unavailable
 * rather than throwing, so a deployment without Stripe is a product that
 * works on trial rather than a product that crashes.
 */

const API = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 15_000;

function secretKey(): string | null {
  return process.env["STRIPE_SECRET_KEY"]?.trim() || null;
}

/*
 * A price that is set, not merely present. docker-compose passes every
 * setting through, so an unset STRIPE_PRICE_ID arrives as an empty string;
 * checking for `undefined` switched card billing on with no price the moment
 * a key was added, every checkout failed at Stripe, and the no-card trial
 * the subscribe button otherwise starts was gone with it.
 */
export function isBillingConfigured(): boolean {
  return secretKey() !== null && Boolean(process.env["STRIPE_PRICE_ID"]?.trim());
}

/**
 * Which Stripe price sells which add-on.
 *
 * The mapping lives here, in environment variables, rather than being
 * inferred from a price's nickname or lookup key. Someone renaming a price in
 * the Stripe dashboard on a Tuesday must not be able to switch off every
 * home's aftercare, and a price nickname is exactly the sort of field that
 * gets tidied up by whoever is doing the VAT.
 */
function addOnPrices(): Map<string, AddOnKey> {
  const mapping = new Map<string, AddOnKey>();
  const aftercare = process.env["STRIPE_PRICE_ID_AFTERCARE"];
  if (aftercare) mapping.set(aftercare, "aftercare");
  return mapping;
}

/**
 * The metered per-case line, and the meter it reports against.
 *
 * Both or neither. A deployment with a metered price on the subscription but
 * no meter event name would invoice every home for zero funerals a month and
 * look, from the inside, exactly like a product nobody was using.
 */
export function isCaseMeteringConfigured(): boolean {
  return (
    secretKey() !== null &&
    Boolean(process.env["STRIPE_PRICE_ID_CASE"]) &&
    Boolean(process.env["STRIPE_CASE_METER_EVENT"])
  );
}

async function stripe<T>(
  path: string,
  body?: Record<string, string>,
): Promise<T> {
  const key = secretKey();
  if (!key) throw new Error("Stripe is not configured on this deployment.");

  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body) } : {}),
    /*
     * Fetch waits as long as the far end likes, and a webhook asking about a
     * subscription holds that customer's turn, and a pooled connection,
     * while it waits. Stripe answers in well under a second; one that has
     * not answered in fifteen is not going to.
     */
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });

  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    logger.error(
      { status: response.status, detail: payload.error?.message, path },
      "Stripe call failed",
    );
    throw new Error(payload.error?.message ?? "Stripe refused that request.");
  }

  return payload;
}

/** Reuse the home's customer, or make one. Keeps one customer per home. */
async function customerFor(home: FuneralHome, email: string): Promise<string> {
  if (home.stripeCustomerId) return home.stripeCustomerId;

  const customer = await stripe<{ id: string }>("/customers", {
    email,
    name: home.name,
    "metadata[funeralHomeId]": String(home.id),
  });

  await db
    .update(funeralHomesTable)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(funeralHomesTable.id, home.id));

  return customer.id;
}

/** Whether the annual price (and its yearly funeral meter) exist here. */
export function isAnnualConfigured(): boolean {
  return Boolean(process.env["STRIPE_PRICE_ID_ANNUAL"]?.trim());
}

/*
 * Stripe refuses a checkout trial ending less than 48 hours after the
 * request lands. Ten minutes over, so a slow request is not refused for it.
 */
const SHORTEST_CHECKOUT_TRIAL_MS = (48 * 60 + 10) * 60 * 1000;

/**
 * When a subscription started at checkout now would take its first payment:
 * the end of the trial the home is on -- the days it has left, rounded up to
 * the shortest trial Stripe will hold -- or null, to charge at checkout.
 *
 * Only a home on our own trial gets one. Every subscribe button used to give
 * a fresh thirty days, so a home on the last day of its trial got another
 * month, and one that cancelled and subscribed again got another month each
 * time it did.
 */
export function checkoutTrialEnd(home: FuneralHome, now = new Date()): Date | null {
  if (home.subscriptionStatus !== "trial" || hasLiveSubscription(home)) return null;
  if (home.trialEndsAt === null || home.trialEndsAt <= now) return null;
  const shortest = new Date(now.getTime() + SHORTEST_CHECKOUT_TRIAL_MS);
  return home.trialEndsAt > shortest ? home.trialEndsAt : shortest;
}

export async function createCheckoutSession(options: {
  home: FuneralHome;
  email: string;
  returnUrl: string;
  /** Add-ons the director ticked on the way to checkout. */
  addOns?: AddOnKey[];
  /** `year` bills twelve months for the price of ten. */
  interval?: "month" | "year";
}): Promise<string> {
  const annual = options.interval === "year" && isAnnualConfigured();
  const customer = await customerFor(options.home, options.email);

  const body: Record<string, string> = {
    mode: "subscription",
    customer,
    success_url: `${options.returnUrl}?billing=done`,
    cancel_url: `${options.returnUrl}?billing=cancelled`,
    // So the webhook can find the home even if the customer record is new.
    "subscription_data[metadata][funeralHomeId]": String(options.home.id),
    "metadata[funeralHomeId]": String(options.home.id),
  };

  /*
   * The rest of the home's own trial, if it is on one: Stripe takes the
   * first payment when it ends. A card is asked for either way. Without one
   * Stripe cancelled the subscription at the end of the trial, and a home
   * that had pressed Subscribe had subscribed to nothing; the `cancel` below
   * is for a card taken out again in the portal before then, so that is a
   * clean end rather than an invoice nobody can pay.
   */
  const trialEnd = checkoutTrialEnd(options.home);
  if (trialEnd) {
    body["subscription_data[trial_end]"] = String(Math.floor(trialEnd.getTime() / 1000));
    body["subscription_data[trial_settings][end_behavior][missing_payment_method]"] =
      "cancel";
  }

  // The base subscription, and then whatever else is on the contract. Index
  // is tracked rather than hard-coded because the lines below are optional
  // and a gap in `line_items[n]` is a request Stripe rejects.
  let line = 0;
  body[`line_items[${line}][price]`] = annual
    ? process.env["STRIPE_PRICE_ID_ANNUAL"]!
    : process.env["STRIPE_PRICE_ID"]!;
  body[`line_items[${line}][quantity]`] = "1";
  line += 1;

  const prices = addOnPrices();
  for (const [priceId, key] of prices) {
    if (!options.addOns?.includes(key)) continue;
    body[`line_items[${line}][price]`] = priceId;
    body[`line_items[${line}][quantity]`] = "1";
    line += 1;
  }

  /*
   * The per-case line. Metered, so it carries no quantity -- Stripe rejects
   * one on a metered price, and the number of funerals is reported after the
   * fact by `metering.ts` rather than guessed at checkout.
   *
   * It goes on every subscription when it is configured, including the
   * smallest home's. That is the point of pricing this way: a home with nine
   * funerals a year pays for nine, which is what makes the base rate low
   * enough for them to say yes to at all.
   */
  // One interval per subscription: an annual plan meters funerals yearly.
  const casePrice = annual
    ? process.env["STRIPE_PRICE_ID_CASE_ANNUAL"]
    : process.env["STRIPE_PRICE_ID_CASE"];
  if (casePrice && isCaseMeteringConfigured()) {
    body[`line_items[${line}][price]`] = casePrice;
    line += 1;
  }

  const session = await stripe<{ url: string }>("/checkout/sessions", body);

  return session.url;
}

/** Stripe's own page for cards, invoices and cancelling. */
export async function createPortalSession(options: {
  home: FuneralHome;
  email: string;
  returnUrl: string;
}): Promise<string> {
  const customer = await customerFor(options.home, options.email);

  const session = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer,
    return_url: options.returnUrl,
  });

  return session.url;
}

/**
 * Start (or extend) the no-card free trial from a subscribe button.
 *
 * Never shortens a trial already running and never touches a home that is
 * paying. A suspended home stays suspended: `canOpenCases` asks that first.
 */
export async function startFreeTrial(
  home: FuneralHome,
  now = new Date(),
): Promise<FuneralHome> {
  if (home.subscriptionStatus === "active" || home.subscriptionStatus === "past_due") {
    return home;
  }

  const days = freeTrialDays();
  const fresh = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const current =
    home.subscriptionStatus === "trial" && home.trialEndsAt !== null
      ? home.trialEndsAt
      : null;
  const trialEndsAt = current && current > fresh ? current : fresh;

  const [updated] = await db
    .update(funeralHomesTable)
    .set({
      subscriptionStatus: "trial",
      trialEndsAt,
      // A new trial earns its own reminders.
      trialRemindersSent: "",
      // This trial is ours. Left pointing at a subscription that has ended,
      // it read as one Stripe was holding: no reminders, and an end that
      // waited on a webhook that was never coming (`trialHasEnded`).
      stripeSubscriptionId: null,
      updatedAt: now,
    })
    .where(eq(funeralHomesTable.id, home.id))
    .returning();

  logger.info({ funeralHomeId: home.id, trialEndsAt }, "Free trial started");
  return updated!;
}

/* ------------------------------------------------------------- webhooks -- */

type StripeSubscription = {
  id: string;
  status: string;
  current_period_end?: number;
  trial_end?: number | null;
  metadata?: { funeralHomeId?: string; homeGroupId?: string };
  customer?: string;
  items?: {
    data?: Array<{
      id?: string;
      quantity?: number;
      current_period_end?: number;
      price?: { id?: string; recurring?: { usage_type?: string } | null };
    }>;
  };
};

/**
 * Which add-ons this subscription's line items pay for.
 *
 * Derived fresh from the subscription on every event rather than accumulated,
 * so that removing a line item in Stripe actually removes the entitlement.
 * An entitlement set that only ever grew would mean a home that cancelled an
 * add-on kept it for ever, which is a bug that only ever costs us money in
 * one direction and so would take years for anyone to notice.
 */
function entitlementsFrom(subscription: StripeSubscription): string {
  const prices = addOnPrices();
  const keys: AddOnKey[] = [];

  for (const item of subscription.items?.data ?? []) {
    const key = item.price?.id ? prices.get(item.price.id) : undefined;
    if (key) keys.push(key);
  }

  return serialiseEntitlements(keys);
}

/**
 * Map Stripe's subscription states onto the two questions this app asks.
 *
 * Stripe has more states than the product needs. `active` is a paying
 * customer; `past_due` and `unpaid` mean Stripe is chasing, which is not a
 * reason to lock a director out mid-funeral.
 *
 * `trialing` is a trial, held by Stripe rather than by us: a home that
 * subscribed before its free days ran out, which Stripe will charge when
 * they do. It was "active", and that was wrong three ways. The console said
 * "Active, renewing" about a home that had paid nothing; the funerals it
 * served in its free days were counted as billable rather than waived, as
 * the price list promises; and the end of the trial was nowhere the app
 * could see it. As a trial, `trial_end` becomes the home's trial end.
 *
 * `incomplete` is a first payment still going through, and
 * `incomplete_expired` one that never did. Neither says anything about the
 * home, so neither changes it: `null`. They used to fall through to
 * "canceled", which took a home on a perfectly good trial off new cases for
 * the time between pressing Subscribe and the payment clearing -- a day, for
 * a card waiting on the bank -- and until the next renewal when the
 * `created` event and the `updated` that paid it carried the same second,
 * because the second of the two was then dropped as stale.
 *
 * Everything else is over.
 */
function mapStatus(stripeStatus: string): string | null {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "incomplete":
    case "incomplete_expired":
      return null;
    default:
      return "canceled";
  }
}

function isLive(subscription: StripeSubscription): boolean {
  const status = mapStatus(subscription.status);
  return status !== null && status !== "canceled";
}

/**
 * When the subscription next renews.
 *
 * On the subscription in older API versions, and on each item since
 * 2025-03-31, which is the version a Stripe account opened now is given.
 * Read from the subscription alone, the renewal date was blank on every
 * new account. The items can differ when one was added mid-period; the
 * latest is when the whole bill has renewed.
 */
function periodEndOf(subscription: StripeSubscription): Date | null {
  const seconds =
    subscription.current_period_end ??
    Math.max(0, ...(subscription.items?.data ?? []).map((item) => item.current_period_end ?? 0));
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

/** Stripe's trial end for a trial it holds; otherwise the one already set. */
function trialEndOf(subscription: StripeSubscription, current: Date | null): Date | null {
  return mapStatus(subscription.status) === "trial" && subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : current;
}

/** Either the pool or the transaction holding a customer's turn. */
type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whether a subscription should be applied to a home or group that is on
 * `currentId`, and if not, why not -- for the log.
 *
 * Two kinds change nothing. One whose first payment has not gone through
 * (see `mapStatus`), and one that has ended but is not the subscription the
 * account is on: a home that cancelled and subscribed again has an old
 * subscription's last events still arriving, and the old one ending must not
 * cancel the new.
 *
 * Then, for a subscription taken from an event's own payload rather than
 * fetched from Stripe, the event has to be newer than the last one applied.
 * Stripe does not promise delivery order, so an `updated` queued before a
 * `deleted` can land after it, and applying whichever arrived last could
 * un-cancel an account that has cancelled.
 */
function reasonToSkip(
  subscription: StripeSubscription,
  account: { stripeSubscriptionId: string | null; stripeEventCreatedAt: Date | null },
  eventCreatedAt: Date,
  current: boolean,
): string | null {
  const status = mapStatus(subscription.status);
  if (status === null) {
    return "Subscription has no first payment yet; nothing changes until it does";
  }
  if (
    status === "canceled" &&
    account.stripeSubscriptionId !== null &&
    account.stripeSubscriptionId !== subscription.id
  ) {
    return "Ignoring the end of a subscription the account is no longer on";
  }
  if (
    !current &&
    account.stripeEventCreatedAt &&
    account.stripeEventCreatedAt >= eventCreatedAt
  ) {
    return "Ignoring a Stripe event older than the one already applied";
  }
  return null;
}

/** The later of the two, so the high-water mark never moves back. */
function latest(applied: Date | null, incoming: Date): Date {
  return applied && applied > incoming ? applied : incoming;
}

/**
 * Apply a subscription to the home or group it belongs to.
 *
 * Finds the home by the metadata we set at checkout, falling back to the
 * customer id -- the fallback matters because a subscription changed from
 * Stripe's dashboard, rather than through checkout, carries no metadata.
 *
 * `current` says where the subscription came from. Fetched from Stripe by
 * `applySubscriptionEvent`, it is the state now, and is applied whatever
 * order the events that prompted the fetch arrived in. Taken from an event's
 * payload -- a deployment with a webhook secret and no API key, or a test --
 * it is the state when the event was created, `eventCreatedAt`, and is
 * subject to the staleness check in `reasonToSkip`.
 */
export async function applySubscription(
  subscription: StripeSubscription,
  eventCreatedAt: Date,
  options: { current?: boolean; tx?: Db } = {},
): Promise<boolean> {
  const run = options.tx ?? db;

  // A group's contract is checked for first. A subscription can only belong
  // to one of the two, and a group's covers every location under it.
  if (await applyGroupSubscription(subscription, eventCreatedAt, options)) return true;

  const byMetadata = Number(subscription.metadata?.funeralHomeId);

  const [home] = Number.isInteger(byMetadata) && byMetadata > 0
    ? await run
        .select()
        .from(funeralHomesTable)
        .where(eq(funeralHomesTable.id, byMetadata))
        .limit(1)
    : subscription.customer
      ? await run
          .select()
          .from(funeralHomesTable)
          .where(eq(funeralHomesTable.stripeCustomerId, subscription.customer))
          .limit(1)
      : [];

  if (!home) {
    logger.warn(
      { subscription: subscription.id },
      "Stripe sent a subscription we could not match to a home",
    );
    return false;
  }

  const skip = reasonToSkip(subscription, home, eventCreatedAt, options.current ?? false);
  if (skip) {
    logger.warn(
      { funeralHomeId: home.id, subscription: subscription.id, status: subscription.status },
      skip,
    );
    return true;
  }

  await run
    .update(funeralHomesTable)
    .set({
      subscriptionStatus: mapStatus(subscription.status)!,
      stripeSubscriptionId: subscription.id,
      trialEndsAt: trialEndOf(subscription, home.trialEndsAt),
      currentPeriodEndsAt: periodEndOf(subscription),
      entitlements: entitlementsFrom(subscription),
      stripeEventCreatedAt: latest(home.stripeEventCreatedAt, eventCreatedAt),
      updatedAt: new Date(),
    })
    .where(eq(funeralHomesTable.id, home.id));

  logger.info(
    { funeralHomeId: home.id, status: subscription.status },
    "Subscription updated",
  );

  return true;
}

/**
 * The same thing for a group, and then down onto its locations.
 *
 * The fan-out is the load-bearing part. `canOpenCases` reads one row and
 * takes one predicate, and every route in the API calls it that way; making
 * it join to a group for the subset of homes that have one would be a gate
 * that behaves differently for different tenants, which is the kind of gate
 * that is eventually wrong for somebody. So the group's answer is written
 * down onto every member home at the moment it changes, and the gate carries
 * on reading the home.
 *
 * What is *not* copied down is `stripeCustomerId` and `stripeSubscriptionId`.
 * Those stay on the group, because a director at one location must not be
 * able to open Stripe's billing portal and cancel the contract covering the
 * other thirty-nine.
 */
async function applyGroupSubscription(
  subscription: StripeSubscription,
  eventCreatedAt: Date,
  options: { current?: boolean; tx?: Db },
): Promise<boolean> {
  const run = options.tx ?? db;
  const byMetadata = Number(subscription.metadata?.homeGroupId);

  const [group] =
    Number.isInteger(byMetadata) && byMetadata > 0
      ? await run
          .select()
          .from(homeGroupsTable)
          .where(eq(homeGroupsTable.id, byMetadata))
          .limit(1)
      : subscription.customer
        ? await run
            .select()
            .from(homeGroupsTable)
            .where(eq(homeGroupsTable.stripeCustomerId, subscription.customer))
            .limit(1)
        : [];

  if (!group) return false;

  /*
   * The same checks the single-home path makes, against the group's own
   * row, because the two paths write different rows and each has to check
   * its own.
   *
   * They matter more here. A stale `subscription.updated` arriving after a
   * `subscription.deleted` re-activates one account on a single home; on a
   * group it re-activates every location under the contract, because the
   * answer below is written down onto all of them in one statement.
   */
  const skip = reasonToSkip(subscription, group, eventCreatedAt, options.current ?? false);
  if (skip) {
    logger.warn(
      { homeGroupId: group.id, subscription: subscription.id, status: subscription.status },
      skip,
    );
    return true;
  }

  const status = mapStatus(subscription.status)!;
  const entitlements = entitlementsFrom(subscription);
  const trialEndsAt = trialEndOf(subscription, group.trialEndsAt);
  const periodEnd = periodEndOf(subscription);
  const stamped = latest(group.stripeEventCreatedAt, eventCreatedAt);
  const now = new Date();

  const write = async (tx: Db) => {
    await tx
      .update(homeGroupsTable)
      .set({
        subscriptionStatus: status,
        stripeSubscriptionId: subscription.id,
        trialEndsAt,
        currentPeriodEndsAt: periodEnd,
        entitlements,
        stripeEventCreatedAt: stamped,
        updatedAt: now,
      })
      .where(eq(homeGroupsTable.id, group.id));

    await tx
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: status,
        currentPeriodEndsAt: periodEnd,
        trialEndsAt,
        entitlements,
        // Stamped on the locations too, so each row records which event
        // shaped it and a later home-level event cannot be mistaken for an
        // earlier one.
        stripeEventCreatedAt: stamped,
        updatedAt: now,
      })
      .where(eq(funeralHomesTable.groupId, group.id));
  };

  // Inside the caller's transaction when there is one; in one of its own
  // otherwise, so the group and its locations never disagree.
  if (options.tx) await write(options.tx);
  else await db.transaction(write);

  logger.info(
    { homeGroupId: group.id, status: subscription.status },
    "Group subscription updated, and written down onto its locations",
  );

  return true;
}

/**
 * Something Stripe could not tell us, for the webhook to answer with a 503
 * so Stripe sends the event again. Anything but a 2xx is retried, with
 * backoff, for three days; a 200 would have been the last we heard of it.
 */
async function askStripe<T>(path: string): Promise<T> {
  try {
    return await stripe<T>(path);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error), path },
      "Could not ask Stripe about a subscription",
    );
    throw new HttpError(
      503,
      "Stripe could not be asked about that subscription just now. Send it again.",
    );
  }
}

/**
 * What the webhook does with a subscription event.
 *
 * With an API key, it believes Stripe rather than the event. The payload is
 * the subscription as it was when Stripe queued the event, and Stripe
 * promises nothing about the order events arrive in; worse, the `created`
 * and `updated` that a checkout produces often carry the same second, so no
 * comparison of timestamps can put them in order. So the event is taken as
 * a prompt, and the subscription is fetched as it is now and applied.
 *
 * Fetched and applied one delivery at a time per customer, under an advisory
 * lock held for the length of a transaction. Without that, two deliveries
 * could each ask, and the answer that left Stripe first could be written
 * last: active, from before a cancellation, over the cancellation.
 *
 * A subscription that has ended is not the same as a customer with none. A
 * director who finished checkout in two tabs and cancelled one is still
 * paying for the other, so before a home is cancelled Stripe is asked for
 * any other subscription of theirs that is still running, and the home moves
 * onto that one instead.
 *
 * With no API key there is nobody to ask, and the payload is applied as it
 * stands, oldest-event-loses (`reasonToSkip`).
 */
export async function applySubscriptionEvent(
  sent: StripeSubscription,
  eventCreatedAt: Date,
): Promise<boolean> {
  if (!secretKey()) return applySubscription(sent, eventCreatedAt);

  return db.transaction(async (tx) => {
    await advisoryLockOnText(tx, LOCKS.stripeCustomer, sent.customer ?? sent.id);

    let subscription = await askStripe<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(sent.id)}`,
    );

    if (mapStatus(subscription.status) === "canceled" && subscription.customer) {
      // Not cancelled ones: by default Stripe lists every other status,
      // newest first.
      const others = await askStripe<{ data: StripeSubscription[] }>(
        `/subscriptions?customer=${encodeURIComponent(subscription.customer)}&limit=100`,
      );
      const running = others.data.find(
        (other) => other.id !== subscription.id && isLive(other),
      );
      if (running) {
        logger.info(
          { ended: subscription.id, running: running.id },
          "A subscription ended while another of the customer's is still running",
        );
        subscription = running;
      }
    }

    return applySubscription(subscription, eventCreatedAt, { current: true, tx });
  });
}

export type SeatSync =
  | { synced: true; groupName: string; locations: number }
  | { synced: false; groupName: string; locations: number; reason: string };

/**
 * Make a group's subscription charge for the locations it has now.
 *
 * Checkout sets the per-location lines to the number of locations on the
 * day the contract starts, and nothing changed them after: a location moved
 * in was run for free, and one moved out went on being billed, until
 * somebody compared the invoice with the estate. Called after every move,
 * for each group the move touched.
 *
 * Every per-location line is set -- the base and any add-on, both sold per
 * location -- and the metered funeral line is left alone: it has no
 * quantity, and Stripe refuses one. Stripe prorates the change onto the
 * next invoice. Under the same per-customer turn as the webhook, so two
 * moves at once cannot leave Stripe holding the count from the first.
 *
 * Null when there is nothing to change: no Stripe here, or no running
 * subscription. A failure is returned rather than thrown, because the move
 * has happened and must stand -- the branch has funerals this week either
 * way -- and whoever made it needs to be told what to fix in Stripe.
 */
export async function syncGroupSeats(groupId: number): Promise<SeatSync | null> {
  if (!secretKey()) return null;

  return db.transaction(async (tx) => {
    const [group] = await tx
      .select()
      .from(homeGroupsTable)
      .where(eq(homeGroupsTable.id, groupId))
      .limit(1);
    if (!group || !hasLiveSubscription(group)) return null;

    await advisoryLockOnText(
      tx,
      LOCKS.stripeCustomer,
      group.stripeCustomerId ?? group.stripeSubscriptionId!,
    );

    const [row] = await tx
      .select({ total: count() })
      .from(funeralHomesTable)
      .where(eq(funeralHomesTable.groupId, group.id));
    // At least one, as at checkout: a contract with no locations is still a
    // contract, and ending it is a conversation, not a side effect.
    const locations = Math.max(1, row?.total ?? 0);
    const path = `/subscriptions/${encodeURIComponent(group.stripeSubscriptionId!)}`;

    try {
      const subscription = await stripe<StripeSubscription>(path);
      const body: Record<string, string> = {};
      let line = 0;
      for (const item of subscription.items?.data ?? []) {
        if (!item.id || item.price?.recurring?.usage_type === "metered") continue;
        if (item.quantity === locations) continue;
        body[`items[${line}][id]`] = item.id;
        body[`items[${line}][quantity]`] = String(locations);
        line += 1;
      }
      if (line > 0) await stripe(path, body);

      logger.info({ homeGroupId: group.id, locations }, "Group subscription matched to its locations");
      return { synced: true as const, groupName: group.name, locations };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(
        { homeGroupId: group.id, locations, err: reason },
        "Could not match a group's subscription to its locations",
      );
      return { synced: false as const, groupName: group.name, locations, reason };
    }
  });
}

/**
 * Checkout for a group, against the group's own customer.
 *
 * Separate from the home's checkout rather than generalised over both,
 * because the two have genuinely different postures: a director buys for
 * their own home from inside the console, and a group contract is set up by
 * someone at the platform talking to a person who owns forty funeral homes.
 * Collapsing them would mean one function where the difference between those
 * two is a boolean.
 */
export async function createGroupCheckoutSession(options: {
  group: HomeGroup;
  email: string;
  returnUrl: string;
  addOns?: AddOnKey[];
  /** How many locations the contract covers. */
  locations: number;
}): Promise<string> {
  const key = secretKey();
  if (!key) throw new Error("Stripe is not configured on this deployment.");

  let customer = options.group.stripeCustomerId;

  if (!customer) {
    const created = await stripe<{ id: string }>("/customers", {
      email: options.email,
      name: options.group.name,
      "metadata[homeGroupId]": String(options.group.id),
    });
    customer = created.id;

    await db
      .update(homeGroupsTable)
      .set({ stripeCustomerId: customer, updatedAt: new Date() })
      .where(eq(homeGroupsTable.id, options.group.id));
  }

  const body: Record<string, string> = {
    mode: "subscription",
    customer,
    success_url: `${options.returnUrl}?billing=done`,
    cancel_url: `${options.returnUrl}?billing=cancelled`,
    "subscription_data[metadata][homeGroupId]": String(options.group.id),
    "metadata[homeGroupId]": String(options.group.id),
  };

  let line = 0;
  body[`line_items[${line}][price]`] = process.env["STRIPE_PRICE_ID"]!;
  // One base subscription per location. The per-case line below is not
  // multiplied: it is metered, and forty locations reporting into one meter
  // is exactly the consolidated invoice a group is buying.
  body[`line_items[${line}][quantity]`] = String(Math.max(1, options.locations));
  line += 1;

  const prices = addOnPrices();
  for (const [priceId, addOn] of prices) {
    if (!options.addOns?.includes(addOn)) continue;
    body[`line_items[${line}][price]`] = priceId;
    body[`line_items[${line}][quantity]`] = String(
      Math.max(1, options.locations),
    );
    line += 1;
  }

  const casePrice = process.env["STRIPE_PRICE_ID_CASE"];
  if (casePrice && isCaseMeteringConfigured()) {
    body[`line_items[${line}][price]`] = casePrice;
    line += 1;
  }

  const session = await stripe<{ url: string }>("/checkout/sessions", body);
  return session.url;
}

/* --------------------------------------------------------- the meter -- */

/**
 * Tell Stripe about one funeral.
 *
 * `identifier` is what makes this safe to retry: Stripe deduplicates meter
 * events on it, so a job that runs twice, or a response we never saw the end
 * of, cannot bill a home twice for the same death. The database's unique
 * index is the first guarantee of that and this is the second, because the
 * failure mode is bad enough to be worth two.
 *
 * Returns `duplicate` when Stripe says it already has this event. That is a
 * success from where we are standing -- the charge exists -- and treating it
 * as a failure would leave a row retrying for ever against a meter that had
 * already counted it.
 */
export async function reportCaseToMeter(options: {
  customerId: string;
  caseId: number;
  at: Date;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; reason: string }> {
  const eventName = process.env["STRIPE_CASE_METER_EVENT"];
  if (!eventName) return { ok: false, reason: "No meter is configured." };

  try {
    await stripe("/billing/meter_events", {
      event_name: eventName,
      identifier: `case-${options.caseId}`,
      timestamp: String(Math.floor(options.at.getTime() / 1000)),
      "payload[stripe_customer_id]": options.customerId,
      "payload[value]": "1",
    });

    return { ok: true, duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Stripe's wording for "I already have this identifier". Matched on the
    // text because the error carries no code that distinguishes it, which is
    // unpleasant but better than the alternative of retrying for ever.
    if (/already exists|duplicate/i.test(message)) {
      return { ok: true, duplicate: true };
    }

    return { ok: false, reason: message };
  }
}

/**
 * Verify Stripe's signature over the raw body.
 *
 * Written out rather than pulled from the SDK, and worth being careful with:
 * this endpoint is unauthenticated by necessity, so the signature is the only
 * thing standing between a stranger and marking their own home as paid.
 */
export async function verifyWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): Promise<unknown | null> {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret || !signatureHeader) return null;

  const fields = signatureHeader.split(",").map((part) => {
    const [key, ...rest] = part.split("=");
    return [key?.trim() ?? "", rest.join("=")] as const;
  });

  const timestamp = fields.find(([key]) => key === "t")?.[1];
  /*
   * Every v1, not the last one. While a webhook secret is being rolled,
   * Stripe signs each event with the old secret and the new, in no promised
   * order; keeping only the last meant that for the length of the rollover
   * every event signed in the other order was refused, and a home that paid
   * was never marked as paying.
   */
  const provided = fields.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || provided.length === 0) return null;

  // Five minutes, Stripe's own recommendation: long enough for a slow
  // delivery, short enough that a captured request cannot be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return null;

  const { createHmac, timingSafeEqual } = await import("node:crypto");

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const signed = provided.some((signature) => {
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!signed) return null;

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}
