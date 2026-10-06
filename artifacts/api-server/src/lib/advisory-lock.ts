import { sql } from "drizzle-orm";
import type { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The first number of every Postgres advisory lock this server takes.
 *
 * An advisory lock is a pair of numbers that Postgres holds for whoever asks
 * first, and checks against nothing else. Two features that happened on the
 * same pair would queue behind each other's work for no reason, so each
 * takes the two-number form with its own namespace first, from this one
 * list. The one-number form is a separate space, and nothing here uses it.
 */
export const LOCKS = {
  /** One address's account emails: `lib/email-ceiling.ts`. */
  emailCeiling: 1,
  /** One home's hourly ceilings on its public request form: `routes/public.ts`. */
  frontDoor: 2,
  /**
   * One Stripe customer's subscription, as the webhook applies it and as a
   * group's seats are set: `lib/billing.ts`. Keyed by the customer's id.
   */
  stripeCustomer: 3,
  /** One home's daily count of people added: `routes/home.ts`. */
  staffAdded: 4,
} as const;

/**
 * Wait for the lock on `key` within `namespace`, and hold it until the
 * transaction ends: committing or rolling back is what lets it go, so there
 * is no release to forget on the way out of an error.
 */
export async function advisoryLock(tx: Tx, namespace: number, key: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${namespace}::int, ${key}::int)`);
}

/**
 * The same, for a key that is text -- a Stripe customer's id -- hashed by
 * Postgres. Two keys that share a hash only wait for each other.
 */
export async function advisoryLockOnText(tx: Tx, namespace: number, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))`);
}
