/**
 * What we charge, in one place: the marketing site shows it, the Stripe
 * setup script creates it, and PRICING.md explains it. Invoices still come
 * from Stripe; nothing here is billed by this code.
 *
 * Pure constants and arithmetic, no database, so the website can import it.
 */

export const PRICE_BOOK = {
  currency: "usd",
  /** Per location, per month, in cents. */
  locationMonthlyCents: 16_900,
  /** Per funeral served (at-need, counted once), in cents. */
  perFuneralCents: 700,
  /** Annual billing: pay for ten months, get twelve. */
  annualMonthsFree: 2,
  activationFeeCents: 0,
  /** The no-card trial on every subscribe button. */
  trialDays: 30,
  /** Aftercare, SMS and email are in the base price, not add-ons. */
  included: [
    "Family portal, photos, obituary and print studio",
    "Grief aftercare by email and text, in your name",
    "Texts and email to families at no extra cost",
    "Colorado's 72-hour certificate clock",
    "Case export, and a CSV of every case",
  ],
} as const;

/** Per location, per year, in cents: twelve months for the price of ten. */
export const locationAnnualCents =
  PRICE_BOOK.locationMonthlyCents * (12 - PRICE_BOOK.annualMonthsFree);

/** A home's monthly bill, in cents, before tax. */
export function monthlyBillCents(funerals: number, locations = 1): number {
  return PRICE_BOOK.locationMonthlyCents * locations + PRICE_BOOK.perFuneralCents * funerals;
}

export const dollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

/**
 * The Stripe catalogue `scripts/src/stripe-setup.ts` creates, keyed by
 * lookup key so re-running it finds rather than duplicates. Off until
 * STRIPE_SECRET_KEY is set.
 */
export const STRIPE_CATALOGUE = [
  {
    lookupKey: "continuum_location_monthly",
    env: "STRIPE_PRICE_ID",
    product: "Continuum Aftercare — per location",
    unitAmount: PRICE_BOOK.locationMonthlyCents,
    interval: "month",
    usage: "licensed",
  },
  {
    lookupKey: "continuum_location_annual",
    env: "STRIPE_PRICE_ID_ANNUAL",
    product: "Continuum Aftercare — per location",
    unitAmount: locationAnnualCents,
    interval: "year",
    usage: "licensed",
  },
  {
    lookupKey: "continuum_funeral_served",
    env: "STRIPE_PRICE_ID_CASE",
    product: "Continuum Aftercare — per funeral served",
    unitAmount: PRICE_BOOK.perFuneralCents,
    interval: "month",
    usage: "metered",
  },
  {
    // Stripe wants one interval per subscription, so annual plans meter
    // funerals yearly at the same $7.
    lookupKey: "continuum_funeral_served_annual",
    env: "STRIPE_PRICE_ID_CASE_ANNUAL",
    product: "Continuum Aftercare — per funeral served",
    unitAmount: PRICE_BOOK.perFuneralCents,
    interval: "year",
    usage: "metered",
  },
] as const;

/* ------------------------------------------------------ unit economics -- */

/**
 * What one home costs us a month, in dollars. Assumptions (PRICING.md has
 * the sources): ~45 SMS segments per funeral at ~$0.011 with carrier fees;
 * 10DLC campaign, number and amortised brand vetting ~$4 per home; ~65
 * emails per funeral at Postmark's ~$1.50 per thousand; ~$0.40 of photo
 * storage and backup per funeral; ~$150 of hosting shared across the fleet;
 * ~$25 of support and ~$6 of amortised onboarding per home; Stripe Billing
 * 0.7% plus card 2.9% + 30¢.
 */
export function monthlyCostDollars(funerals: number, homesInFleet: number) {
  const revenue = monthlyBillCents(funerals) / 100;
  const lines = {
    sms: 0.5 * funerals,
    tenDlc: 4,
    email: 0.1 * funerals,
    photoStorage: 0.4 * funerals,
    hostingShare: 150 / homesInFleet,
    support: 25,
    onboarding: 6,
    stripe: revenue * (0.007 + 0.029) + 0.3,
  };
  const total = Object.values(lines).reduce((sum, value) => sum + value, 0);
  return { revenue, lines, total, margin: (revenue - total) / revenue };
}
