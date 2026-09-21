import { eq } from "drizzle-orm";
import {
  db,
  funeralHomesTable,
  homeGroupsTable,
  serialiseEntitlements,
  type AddOnKey,
  type FuneralHome,
  type HomeGroup,
} from "@workspace/db";
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
 * three form-encoded POSTs, the SDK is a large dependency, and keeping the
 * calls visible makes it obvious exactly what leaves this process.
 *
 * With no key configured every function reports that billing is unavailable
 * rather than throwing, so a deployment without Stripe is a product that
 * works on trial rather than a product that crashes.
 */

const API = "https://api.stripe.com/v1";

function secretKey(): string | null {
  return process.env["STRIPE_SECRET_KEY"] || null;
}

export function isBillingConfigured(): boolean {
  return secretKey() !== null && process.env["STRIPE_PRICE_ID"] !== undefined;
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

export async function createCheckoutSession(options: {
  home: FuneralHome;
  email: string;
  returnUrl: string;
  /** Add-ons the director ticked on the way to checkout. */
  addOns?: AddOnKey[];
}): Promise<string> {
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

  // The base subscription, and then whatever else is on the contract. Index
  // is tracked rather than hard-coded because the lines below are optional
  // and a gap in `line_items[n]` is a request Stripe rejects.
  let line = 0;
  body[`line_items[${line}][price]`] = process.env["STRIPE_PRICE_ID"]!;
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
  const casePrice = process.env["STRIPE_PRICE_ID_CASE"];
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

/* ------------------------------------------------------------- webhooks -- */

type StripeSubscription = {
  id: string;
  status: string;
  current_period_end?: number;
  metadata?: { funeralHomeId?: string; homeGroupId?: string };
  customer?: string;
  items?: { data?: Array<{ price?: { id?: string } }> };
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
 * Stripe has more states than the product needs. `trialing` and `active` are
 * both "paying customer"; `past_due` and `unpaid` mean Stripe is chasing,
 * which is not a reason to lock a director out mid-funeral; everything else
 * is over.
 */
function mapStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

/**
 * Apply a subscription change.
 *
 * Finds the home by the metadata we set at checkout, falling back to the
 * customer id — the fallback matters because a subscription changed from
 * Stripe's dashboard, rather than through checkout, carries no metadata.
 */
export async function applySubscription(
  subscription: StripeSubscription,
): Promise<boolean> {
  // A group's contract is checked for first. A subscription can only belong
  // to one of the two, and a group's covers every location under it.
  if (await applyGroupSubscription(subscription)) return true;

  const byMetadata = Number(subscription.metadata?.funeralHomeId);

  const [home] = Number.isInteger(byMetadata) && byMetadata > 0
    ? await db
        .select()
        .from(funeralHomesTable)
        .where(eq(funeralHomesTable.id, byMetadata))
        .limit(1)
    : subscription.customer
      ? await db
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

  await db
    .update(funeralHomesTable)
    .set({
      subscriptionStatus: mapStatus(subscription.status),
      stripeSubscriptionId: subscription.id,
      currentPeriodEndsAt: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      entitlements: entitlementsFrom(subscription),
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
): Promise<boolean> {
  const byMetadata = Number(subscription.metadata?.homeGroupId);

  const [group] =
    Number.isInteger(byMetadata) && byMetadata > 0
      ? await db
          .select()
          .from(homeGroupsTable)
          .where(eq(homeGroupsTable.id, byMetadata))
          .limit(1)
      : subscription.customer
        ? await db
            .select()
            .from(homeGroupsTable)
            .where(eq(homeGroupsTable.stripeCustomerId, subscription.customer))
            .limit(1)
        : [];

  if (!group) return false;

  const status = mapStatus(subscription.status);
  const entitlements = entitlementsFrom(subscription);
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(homeGroupsTable)
      .set({
        subscriptionStatus: status,
        stripeSubscriptionId: subscription.id,
        currentPeriodEndsAt: periodEnd,
        entitlements,
        updatedAt: now,
      })
      .where(eq(homeGroupsTable.id, group.id));

    await tx
      .update(funeralHomesTable)
      .set({
        subscriptionStatus: status,
        currentPeriodEndsAt: periodEnd,
        trialEndsAt: group.trialEndsAt,
        entitlements,
        updatedAt: now,
      })
      .where(eq(funeralHomesTable.groupId, group.id));
  });

  logger.info(
    { homeGroupId: group.id, status: subscription.status },
    "Group subscription updated, and written down onto its locations",
  );

  return true;
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

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key?.trim() ?? "", rest.join("=")];
    }),
  );

  const timestamp = parts["t"];
  const provided = parts["v1"];
  if (!timestamp || !provided) return null;

  // Five minutes, Stripe's own recommendation: long enough for a slow
  // delivery, short enough that a captured request cannot be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return null;

  const { createHmac, timingSafeEqual } = await import("node:crypto");

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}
