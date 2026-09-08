import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  casesTable,
  familyContactsTable,
  FAMILY_LINK_TTL_MS,
  type Case,
  type FamilyContact,
} from "@workspace/db";

/**
 * The family's way in: a token in a texted link, and nothing else.
 *
 * Everything about this file is a deliberate trade. A link that anyone
 * holding it can open is weaker than a password, and it is the right choice
 * here because the alternative is not "a family with passwords" — it is a
 * family that never gets past the sign-up screen, three days after a death,
 * and goes back to emailing the director forty photographs.
 *
 * What makes the trade defensible:
 *
 *  - The token is 32 random bytes. Guessing one is not a threat model.
 *  - Only its SHA-256 lands in the database, so a dump does not hand out
 *    live links.
 *  - It opens exactly one case: photographs of the holder's own relative and
 *    a hymn list. No money moves, and no other family is reachable.
 *  - It expires, and one click revokes it.
 */

/** Sessions are looked up by digest, so the raw token is never at rest. */
export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type MintedLink = {
  /** The working token. Shown once, then unrecoverable. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function mintLink(now = new Date()): MintedLink {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: digestToken(token),
    expiresAt: new Date(now.getTime() + FAMILY_LINK_TTL_MS),
  };
}

/**
 * The URL to paste into a text message.
 *
 * `FAMILY_PORTAL_URL` is the deployed origin of the family app. It falls back
 * to a relative path rather than to a guessed hostname: a link that is
 * obviously incomplete is better than one that looks right and opens
 * somebody else's deployment.
 */
export function linkUrl(token: string): string {
  const base = process.env["FAMILY_PORTAL_URL"]?.replace(/\/+$/, "") ?? "";
  return `${base}/f/${token}`;
}

export type FamilyLinkSession = {
  contact: FamilyContact;
  case: Case;
};

/**
 * Resolve a token to the contact and the case it opens, or undefined.
 *
 * Callers must not distinguish between "unknown", "expired" and "revoked" in
 * what they return: all three are the same 401 and the same screen, which
 * says to ask the funeral home for a new link.
 */
export async function resolveFamilyLink(
  token: string,
  now = new Date(),
): Promise<FamilyLinkSession | undefined> {
  if (!token) return undefined;

  const [row] = await db
    .select({ contact: familyContactsTable, case: casesTable })
    .from(familyContactsTable)
    .innerJoin(casesTable, eq(casesTable.id, familyContactsTable.caseId))
    .where(eq(familyContactsTable.tokenHash, digestToken(token)))
    .limit(1);

  if (!row) return undefined;
  if (row.contact.revokedAt !== null) return undefined;
  if (row.contact.expiresAt <= now) return undefined;

  return { contact: row.contact, case: row.case };
}

/**
 * Record that the link was opened.
 *
 * `firstSeenAt` is written once and answers a question the director actually
 * has — "did that text ever land?" — which is otherwise invisible to them
 * until the family fails to do anything and everyone assumes the worst.
 * Deliberately fire-and-forget: a failure to write a timestamp must never
 * turn into a failed page load for a grieving family.
 */
export async function touchLink(
  contact: FamilyContact,
  now = new Date(),
): Promise<void> {
  await db
    .update(familyContactsTable)
    .set({
      lastSeenAt: now,
      ...(contact.firstSeenAt === null ? { firstSeenAt: now } : {}),
    })
    .where(eq(familyContactsTable.id, contact.id));
}

/** Revoke every live link on a case — used when a case is closed early. */
export async function revokeCaseLinks(
  caseId: number,
  funeralHomeId: number,
  now = new Date(),
): Promise<void> {
  await db
    .update(familyContactsTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(familyContactsTable.caseId, caseId),
        eq(familyContactsTable.funeralHomeId, funeralHomeId),
      ),
    );
}
