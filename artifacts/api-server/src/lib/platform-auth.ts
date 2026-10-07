import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  platformAdminsTable,
  funeralHomesTable,
  usersTable,
  type PlatformAdmin,
  type User,
} from "@workspace/db";
import { sendPlatformPasswordEmail } from "@workspace/mailer";
import {
  createPasswordReset,
  destroyAllSessions,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  normaliseEmail,
  revokePasswordResets,
} from "./auth";
import { consoleUrl } from "./app-urls";
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

  // Ordinarily nobody has registered yet. If somebody has, the account is
  // treated like any other already-confirmed address put on the list.
  for (const email of configured) await reclaimIfConfirmed(email);
}

/**
 * Give a listed address's account to whoever reads its inbox, and to nobody
 * else.
 *
 * Confirming an address proves that somebody can read that inbox. It does
 * not prove that the password on the account, or the session using it, is
 * theirs: registration is open and never asks who is typing the address. A
 * stranger could register a listed address before its owner did -- the
 * bootstrap address on a fresh deployment, or a colleague granted access
 * ahead of their first day -- choose the password, and wait. The owner,
 * finding a confirmation email for an account they were about to open
 * anyway, clicked it, and the stranger's session walked into every
 * customer's records. An owner inviting a listed address into their own
 * home, redeeming the invitation handed back on screen and asking for the
 * confirmation to be sent again got the same.
 *
 * So when a listed address proves its inbox, and when an address that
 * already had is put on the list, every credential somebody else could hold
 * goes: outstanding reset and invitation links first, because one of them
 * may be on a stranger's screen and would otherwise set a new password a
 * moment later; then the password; then every session. What replaces them
 * is a link to choose a password, sent to that inbox and nowhere else --
 * the one thing a squatter cannot have.
 *
 * The cost is one extra email for each platform admin, once, and that is the
 * whole of the population this touches.
 */
export async function reclaimForInbox(
  user: Pick<User, "id" | "email">,
): Promise<void> {
  await revokePasswordResets(user.id);
  await db
    .update(usersTable)
    .set({ passwordHash: null, updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));
  await destroyAllSessions(user.id);

  const token = await createPasswordReset(user.id, INVITE_TTL_MS);

  await sendPlatformPasswordEmail({
    to: user.email,
    link: consoleUrl(`/reset-password?token=${encodeURIComponent(token)}`),
    expiresInDays: INVITE_TTL_DAYS,
  });

  logger.warn(
    { userId: user.id },
    "Platform console address reclaimed for its inbox; password and sessions cleared",
  );
}

/**
 * `reclaimForInbox` for an address just put on the list, when it already
 * belongs to a confirmed account. An unconfirmed one is left alone: it cannot
 * pass the gate yet, and confirming it later reclaims it then, so doing it
 * here as well would only send its owner two emails.
 */
export async function reclaimIfConfirmed(email: string): Promise<void> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normaliseEmail(email)))
    .limit(1);

  if (user?.emailVerified) await reclaimForInbox(user);
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
 *
 * Restoring somebody used to wipe the row clean: the name and the note were
 * overwritten with nulls whenever the form left them blank, and the
 * revocation vanished with no trace in the table. Now a name or note is only
 * replaced when a new one is given, and the caller is handed what the row
 * said *before* -- when and by whom they were taken off -- so the log line
 * for the grant can say "restored, having been removed on ..." rather than
 * reading like a first grant. The row itself can only hold the current state;
 * the log is where the history lives, and this is what keeps it complete.
 */
export async function grantPlatformAdmin(options: {
  email: string;
  displayName?: string | null;
  note?: string | null;
  addedByEmail: string;
}): Promise<{
  admin: PlatformAdmin;
  /** The row as it stood before, when there was one. */
  previous: PlatformAdmin | null;
}> {
  const email = normaliseEmail(options.email);
  const displayName = options.displayName?.trim() || null;
  const note = options.note?.trim() || null;

  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(platformAdminsTable)
      .where(eq(platformAdminsTable.email, email))
      .limit(1);

    const [row] = await tx
      .insert(platformAdminsTable)
      .values({
        email,
        displayName,
        note,
        addedByEmail: options.addedByEmail,
      })
      .onConflictDoUpdate({
        target: platformAdminsTable.email,
        set: {
          // Kept unless replaced. A blank field on the form means "nothing
          // to add", not "forget what we knew".
          displayName: displayName ?? sql`${platformAdminsTable.displayName}`,
          note: note ?? sql`${platformAdminsTable.note}`,
          // Re-granting an active admin changes nothing about who let them
          // in; restoring a revoked one is a new decision, by this person.
          addedByEmail: previous?.revokedAt
            ? options.addedByEmail
            : sql`${platformAdminsTable.addedByEmail}`,
          revokedAt: null,
          revokedByEmail: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return { admin: row!, previous: previous ?? null };
  });
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
