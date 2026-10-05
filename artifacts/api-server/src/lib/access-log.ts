import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  db,
  platformAuditTable,
  usersTable,
  type PlatformAuditEntry,
} from "@workspace/db";

/**
 * A home's own lines from the platform's access log.
 *
 * `platform_audit` exists so that a funeral home's insurer can be told
 * "almost nothing, and here is the log of every time anyone looked". For
 * most of this product's life only the platform console could read it, so
 * the DPA could only promise the log "on request", by hand. This is the
 * home's own window onto it: read-only, scoped by the signed-in owner's own
 * home, and never anybody else's lines.
 *
 * What is deliberately not here: lines with no home on them. Paging through
 * the list of every customer is logged without naming a home -- that is how
 * the log was designed, and inventing a per-home line for it now would be a
 * record of something the log never recorded.
 */

/** Plain words for the codes `admin.ts` writes about a single home. */
const DESCRIPTIONS: Record<string, string> = {
  "home.open": "Opened your account",
  "home.create": "Set up your account",
  "home.suspend": "Suspended your account",
  "home.restore": "Lifted a suspension on your account",
  "home.licensure.update": "Updated your Colorado licensure record",
  "home.practitioner.update": "Updated a practitioner's licence record",
  "home.group.update": "Changed the group your account belongs to",
  "home.internal.update": "Changed whether your account counts as a customer",
  "home.crm.update": "Updated our own customer record for your account",
  "home.staff.reset": "Sent a sign-in email to one of your staff",
  "home.owner.invite": "Invited your account's owner",
  "home.trial.extend": "Extended your free trial",
  "home.sms.update": "Changed your texting setup",
};

/**
 * Anything not in the list above still appears, under its own code. A line
 * this function did not recognise is still a line the home is owed; hiding it
 * because nobody wrote a sentence for it would be the log lying by omission.
 */
export function describeAccess(action: string): string {
  return DESCRIPTIONS[action] ?? `Recorded as "${action}"`;
}

/**
 * The log names a member of staff by id ("emailed a password reset to staff
 * #12"), which is right for the log and useless to the owner reading it. The
 * stored line is never changed; the owner is shown the name of their own
 * colleague in its place, looked up inside their own home only.
 */
async function namesForStaffMentions(
  funeralHomeId: number,
  rows: PlatformAuditEntry[],
): Promise<Map<number, string>> {
  const ids = new Set<number>();
  for (const row of rows) {
    for (const match of (row.detail ?? "").matchAll(/staff #(\d+)/g)) {
      ids.add(Number(match[1]));
    }
  }
  if (ids.size === 0) return new Map();

  const staff = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.funeralHomeId, funeralHomeId),
        inArray(usersTable.id, [...ids]),
      ),
    );

  return new Map(
    staff.flatMap((user) =>
      user.displayName ? [[user.id, user.displayName] as const] : [],
    ),
  );
}

export async function accessLogForHome(
  funeralHomeId: number,
  options: { before?: number; limit: number },
) {
  // One more than asked for, to know whether there is an older page without
  // a second query. Ordered by id, which is insert order: the only order a
  // `before` cursor can page through without skipping two lines written in
  // the same millisecond (the same reasoning as `/admin/audit`).
  const rows = await db
    .select()
    .from(platformAuditTable)
    .where(
      and(
        eq(platformAuditTable.subjectHomeId, funeralHomeId),
        options.before !== undefined
          ? lt(platformAuditTable.id, options.before)
          : undefined,
      ),
    )
    .orderBy(desc(platformAuditTable.id))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  const names = await namesForStaffMentions(funeralHomeId, page);

  return {
    entries: page.map((row) => ({
      id: row.id,
      at: row.createdAt,
      who: row.actorEmail,
      action: row.action,
      what: describeAccess(row.action),
      detail:
        row.detail?.replace(/staff #(\d+)/g, (whole, id: string) =>
          names.get(Number(id)) ?? whole,
        ) ?? null,
    })),
    nextBefore: rows.length > options.limit ? page[page.length - 1]!.id : null,
  };
}
