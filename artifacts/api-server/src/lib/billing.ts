import { eq } from "drizzle-orm";
import { db, funeralHomesTable, type FuneralHome } from "@workspace/db";
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
}): Promise<string> {
  const customer = await customerFor(options.home, options.email);

  const session = await stripe<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    customer,
    "line_items[0][price]": process.env["STRIPE_PRICE_ID"]!,
    "line_items[0][quantity]": "1",
    success_url: `${options.returnUrl}?billing=done`,
    cancel_url: `${options.returnUrl}?billing=cancelled`,
    // So the webhook can find the home even if the customer record is new.
    "subscription_data[metadata][funeralHomeId]": String(options.home.id),
    "metadata[funeralHomeId]": String(options.home.id),
  });

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
  metadata?: { funeralHomeId?: string };
  customer?: string;
};

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
