import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  funeralHomesTable,
  usersTable,
  type PlatformAdmin,
} from "@workspace/db";
import { normaliseEmail } from "./auth";
import { logger } from "./logger";

/**
 * Who at the vendor may look across the tenant boundary.
 *
 * This replaces the `PLATFORM_ADMIN_EMAILS` stand-in. The shape of the check
 * is unchanged and deliberately so: a platform admin is a signed-in staff
 * account that is **also** on this list. One way to authenticate in this
 * application, one cookie to protect, and being on the list is an additional
 * condition rather than an alternative one.
 *
 * What changes is where the list lives, and that mattered for two reasons.
 * Granting a colleague access meant a redeploy and revoking it after somebody
 * left meant another, so in practice the list went stale — the one thing an
 * access list must not do. And an environment variable leaves no trace, so
 * "who could see our families' files last March" had no answer, which is a
 * question a funeral home's insurer asks.
 *
 * Still closed by default. An empty table means nobody is a platform admin and
 * every route under `/admin` answers 403, including to an owner, including in
 * production.
 */

/** Everyone currently allowed in, for the console's own list. */
export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  return db
    .select()
    .from(platformAdminsTable)
    .orderBy(asc(platformAdminsTable.email));
}

async function findActive(email: string): Promise<PlatformAdmin | undefined> {
  const [row] = await db
    .select()
    .from(platformAdminsTable)
    .where(
      and(
        eq(platformAdminsTable.email, normaliseEmail(email)),
        isNull(platformAdminsTable.revokedAt),
      ),
    )
    .limit(1);

  return row;
}

/**
 * Seed the first admin from `PLATFORM_ADMIN_EMAILS`, once, and only into an
 * empty table.
 *
 * Without this there is no way into a fresh deployment's console: the table is
 * empty, so nobody can sign in to add the first row, so the table stays empty.
 * With it, the environment variable is a bootstrap rather than the list — it
 * is read exactly once in a deployment's life, and after that changing it does
 * nothing.
 *
 * The `count` check, rather than a per-address check, is what makes that true.
 * If it seeded any named address at any time, then an address removed from the
 * table would come back on the next restart, and revocation would silently not
 * work — which is worse than the problem this solves.
 *
 * Marks the seeded admin's own home internal at the same time. That row exists
 * because a platform admin needs a staff account and a staff account needs a
 * home; it is not a customer, and leaving it in the customer list is how the
 * console came to report three homes on trial when one of the three was us.
 */
export async function bootstrapPlatformAdmins(): Promise<void> {
  const configured = (process.env["PLATFORM_ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((entry) => normaliseEmail(entry))
    .filter(Boolean);

  if (configured.length === 0) return;

  const existing = await db
    .select({ id: platformAdminsTable.id })
    .from(platformAdminsTable)
    .limit(1);

  if (existing.length > 0) return;

  await db.insert(platformAdminsTable).values(
    configured.map((email) => ({
      email,
      note: "Seeded from PLATFORM_ADMIN_EMAILS on first start.",
    })),
  );

  logger.warn(
    { admins: configured },
    "Seeded platform_admins from PLATFORM_ADMIN_EMAILS. The table is the list " +
      "from now on; the environment variable is no longer read.",
  );

  await markSeededHomesInternal(configured);
}

/**
 * Mark the vendor's own tenants internal, so they leave the customer figures.
 *
 * Best effort and never allowed to throw: an admin who cannot be found yet —
 * because the list was seeded before anyone registered, which is the ordinary
 * order — is simply not marked, and `PATCH /admin/homes/:id` can set it later.
 */
async function markSeededHomesInternal(emails: readonly string[]): Promise<void> {
  try {
    for (const email of emails) {
      const [user] = await db
        .select({ funeralHomeId: usersTable.funeralHomeId })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);

      if (!user) continue;

      await db
        .update(funeralHomesTable)
        .set({ internalAccount: true, updatedAt: new Date() })
        .where(eq(funeralHomesTable.id, user.funeralHomeId));
    }
  } catch (err) {
    logger.warn({ err }, "Could not mark a seeded platform admin's home internal");
  }
}

/** Whether this address is currently allowed into the platform console. */
export async function isPlatformAdmin(email: string): Promise<boolean> {
  return (await findActive(email)) !== undefined;
}

/**
 * Add someone. Idempotent on the address, so re-adding a revoked admin
 * restores them rather than colliding with the unique index — which is what
 * somebody rejoining looks like, and the alternative is an error message about
 * a row they cannot see.
 */
export async function grantPlatformAdmin(options: {
  email: string;
  displayName?: string | null;
  note?: string | null;
  addedByEmail: string;
}): Promise<PlatformAdmin> {
  const email = normaliseEmail(options.email);

  const [row] = await db
    .insert(platformAdminsTable)
    .values({
      email,
      displayName: options.displayName ?? null,
      note: options.note ?? null,
      addedByEmail: options.addedByEmail,
    })
    .onConflictDoUpdate({
      target: platformAdminsTable.email,
      set: {
        displayName: options.displayName ?? null,
        note: options.note ?? null,
        addedByEmail: options.addedByEmail,
        revokedAt: null,
        revokedByEmail: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row!;
}

/**
 * Take someone off the list.
 *
 * Marked rather than deleted, so that the record of who had access when
 * survives them losing it — and so the audit log's actor addresses can still
 * be read against this table.
 */
export async function revokePlatformAdmin(options: {
  email: string;
  revokedByEmail: string;
}): Promise<PlatformAdmin | undefined> {
  const [row] = await db
    .update(platformAdminsTable)
    .set({
      revokedAt: new Date(),
      revokedByEmail: options.revokedByEmail,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformAdminsTable.email, normaliseEmail(options.email)),
        isNull(platformAdminsTable.revokedAt),
      ),
    )
    .returning();

  return row;
}
