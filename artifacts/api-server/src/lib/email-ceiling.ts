import { createHash } from "node:crypto";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, sentEmailsTable, type SentEmailKind } from "@workspace/db";
import { advisoryLock, LOCKS } from "./advisory-lock";
import { normaliseEmail } from "./auth";
import { logger } from "./logger";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Past the longest window counted, a row is no use to anybody. */
const KEEP_MS = 2 * DAY_MS;

/**
 * How many of each one address may be sent in an hour, and in a day.
 *
 * Room for somebody whose first email went to spam to ask twice more, and
 * none for an inbox to be filled: the per-caller limit on these routes is
 * twenty every fifteen minutes, and a few callers taking turns used to be
 * able to send a stranger hundreds a day from our domain.
 */
const CEILINGS: Record<SentEmailKind, { hour: number; day: number }> = {
  // Asked for by registering an address that is already taken, which its
  // owner does by mistake, once. A third in an hour is somebody else.
  account_exists: { hour: 3, day: 6 },
  // A reset link lasts an hour (PASSWORD_RESET_TTL_MS); five in one is a
  // person who is not receiving them, not one who needs a sixth.
  password_reset: { hour: 5, day: 10 },
  // A confirmation lasts fourteen days, and only the signed-in account can
  // ask for another, but that account may be somebody else's typing of a
  // stranger's address.
  email_verification: { hour: 5, day: 10 },
};

/**
 * Count one email of this kind to this person's address, and say whether it
 * may go: false, with nothing counted, once the address has had its share
 * for the hour or the day.
 *
 * The caller then sends nothing and answers exactly as it would have. Every
 * route that sends one of these says the same thing whatever happens, so
 * that it cannot be asked which addresses have accounts, and a ceiling that
 * showed in the answer would be a new way to ask. Unauthenticated callers
 * get their answer before this runs, for the same reason (see
 * `routes/auth.ts`).
 *
 * The count and the row are taken under an advisory lock on the address,
 * held for the transaction, so a burst of requests for one address cannot
 * each see room for one more. The lock's key is the first four bytes of the
 * digest; two addresses that share them only wait for each other.
 */
export async function claimEmail(
  user: { id: number; email: string },
  kind: SentEmailKind,
): Promise<boolean> {
  const digest = createHash("sha256").update(normaliseEmail(user.email)).digest();
  const recipientHash = digest.toString("hex");
  const { hour, day } = CEILINGS[kind];
  const now = Date.now();

  const allowed = await db.transaction(async (tx) => {
    await advisoryLock(tx, LOCKS.emailCeiling, digest.readInt32BE(0));

    // A hundred at a time, skipping any another request is already
    // deleting: never more than a moment's work, and since each call adds
    // at most one row, enough that the table holds two days and no more.
    await tx.delete(sentEmailsTable).where(
      inArray(
        sentEmailsTable.id,
        tx
          .select({ id: sentEmailsTable.id })
          .from(sentEmailsTable)
          .where(lt(sentEmailsTable.sentAt, new Date(now - KEEP_MS)))
          .limit(100)
          .for("update", { skipLocked: true }),
      ),
    );

    const [counts] = await tx
      .select({
        lastHour: sql<number>`count(*) filter (where ${gt(sentEmailsTable.sentAt, new Date(now - HOUR_MS))})::int`,
        lastDay: sql<number>`count(*)::int`,
      })
      .from(sentEmailsTable)
      .where(
        and(
          eq(sentEmailsTable.recipientHash, recipientHash),
          eq(sentEmailsTable.kind, kind),
          gt(sentEmailsTable.sentAt, new Date(now - DAY_MS)),
        ),
      );

    if ((counts?.lastHour ?? 0) >= hour || (counts?.lastDay ?? 0) >= day) return false;

    await tx.insert(sentEmailsTable).values({ recipientHash, kind, sentAt: new Date(now) });
    return true;
  });

  if (!allowed) {
    // The account, never the address: this is exactly the line somebody
    // reads when an inbox is being flooded, and it should not become a list
    // of whose.
    logger.warn({ userId: user.id, kind }, "Email not sent: that address has had its share for now");
  }
  return allowed;
}
