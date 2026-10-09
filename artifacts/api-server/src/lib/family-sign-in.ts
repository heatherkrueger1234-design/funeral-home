import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  db,
  casesTable,
  decedentDisplayName,
  familyContactsTable,
  familySignInsTable,
  funeralHomesTable,
  FAMILY_SIGN_INS_PER_IDENTIFIER_PER_HOUR,
  FAMILY_SIGN_IN_MAX_ATTEMPTS,
  FAMILY_SIGN_IN_TTL_MS,
  type FamilyContact,
  type FuneralHome,
} from "@workspace/db";
import { sendFamilySignInCodeEmail } from "@workspace/mailer";
import { advisoryLockOnText, LOCKS } from "./advisory-lock";
import { mintLink } from "./family-link";
import { normalisePhone, sendSms } from "./sms";
import { logger } from "./logger";

/**
 * Letting a family member back in from the web page, with no link in hand.
 *
 * The link in a text message stays the credential. This is the way to get a
 * new one when the old one is lost: prove you hold the mobile number or the
 * email address the home put on the file by typing back a code sent to it.
 *
 * What it must never become is a way to learn who the homes know, or a way to
 * lock a family out of the link they already have:
 *
 *  - Asking for a code is answered the same whether or not anyone matches,
 *    and the work that differs (the lookup, the send) happens after the
 *    answer has gone.
 *  - Asking for a code changes nothing about the existing link. Only typing
 *    the right code does, so a stranger who knows a phone number can make it
 *    ring but cannot make anything stop working.
 *  - A director's revocation holds. A contact whose link was revoked (the
 *    case was closed, or the director stopped it) is not let back in by a
 *    code; that is the home's decision and the page says to ring them.
 */

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export type Identifier = { kind: "phone" | "email"; identifier: string };

/** A typed mobile number or email address, in the form it is matched on. */
export function parseIdentifier(raw: string): Identifier | null {
  const typed = raw.trim();
  if (!typed) return null;

  if (typed.includes("@")) {
    const email = typed.toLowerCase();
    // Only that it is plausibly an address: the code goes to what is on file,
    // so a loose match here costs nothing.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
      ? { kind: "email", identifier: email }
      : null;
  }

  const phone = normalisePhone(typed);
  return phone ? { kind: "phone", identifier: phone } : null;
}

/**
 * Open a request and return the handle the browser keeps.
 *
 * A row is written whoever is asking about, so what comes back and how long
 * it takes say nothing about whether anyone matches. What follows -- looking
 * the contact up and sending the code -- is for the caller to run after it
 * has answered (`deliverCode`).
 */
export async function startSignIn(
  who: Identifier,
  now = new Date(),
): Promise<{ challenge: string }> {
  const challenge = randomBytes(24).toString("base64url");

  await db.insert(familySignInsTable).values({
    challengeHash: digest(challenge),
    kind: who.kind,
    identifier: who.identifier,
    expiresAt: new Date(now.getTime() + FAMILY_SIGN_IN_TTL_MS),
  });

  // A day is long past any code's life; this keeps the table to a day's
  // requests without a scheduled job.
  await db
    .delete(familySignInsTable)
    .where(lt(familySignInsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));

  return { challenge };
}

/** What a contact is let back into: their own link, never anyone else's. */
type Candidate = {
  contact: FamilyContact;
  home: FuneralHome;
  subjectName: string;
};

/**
 * The files this number or address is on that it may open.
 *
 * Revoked links are left out (see above). So is the person a plan is about,
 * once the file has become an at-need one: they have died, and the link is
 * closed for good (`resolveFamilyLink` holds the same line).
 *
 * Phones are matched on their last ten digits, because homes type them in
 * every shape and the country code is the part most often missing. That is
 * safe to be loose about: the code is sent to the number on the file, not to
 * the one that was typed.
 */
export async function candidatesFor(who: Identifier): Promise<Candidate[]> {
  const matches =
    who.kind === "email"
      ? sql`lower(btrim(${familyContactsTable.email})) = ${who.identifier}`
      : sql`right(regexp_replace(coalesce(${familyContactsTable.phone}, ''), '\\D', '', 'g'), 10) = ${who.identifier
          .replace(/\D/g, "")
          .slice(-10)}`;

  const rows = await db
    .select({ contact: familyContactsTable, case: casesTable, home: funeralHomesTable })
    .from(familyContactsTable)
    .innerJoin(casesTable, eq(casesTable.id, familyContactsTable.caseId))
    .innerJoin(funeralHomesTable, eq(funeralHomesTable.id, familyContactsTable.funeralHomeId))
    .where(and(matches, isNull(familyContactsTable.revokedAt)))
    .orderBy(
      sql`${familyContactsTable.lastSeenAt} desc nulls last`,
      desc(familyContactsTable.id),
    );

  return rows
    .filter((row) => !(row.contact.isSubject && row.case.kind !== "pre_need"))
    .map((row) => ({
      contact: row.contact,
      home: row.home,
      subjectName: decedentDisplayName(row.case),
    }));
}

/**
 * Send the code, if there is anyone to send it to. Silent about every way it
 * can come to nothing: no match, a number that replied STOP, too many codes
 * to this address already, a mail server that is down.
 */
export async function deliverCode(challenge: string, now = new Date()): Promise<void> {
  const challengeHash = digest(challenge);
  const [row] = await db
    .select()
    .from(familySignInsTable)
    .where(eq(familySignInsTable.challengeHash, challengeHash))
    .limit(1);
  if (!row) return;

  const who: Identifier = { kind: row.kind as Identifier["kind"], identifier: row.identifier };

  let candidates = await candidatesFor(who);
  // A STOP is honoured: the number is not texted, whatever it was asked.
  if (who.kind === "phone") candidates = candidates.filter((c) => !c.contact.smsOptedOutAt);
  const first = candidates[0];
  if (!first) return;

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  /*
   * The ceiling is counted and the code recorded under one lock on the
   * address. Counted first and recorded after, a burst of requests all read
   * the same count and every one of them was sent.
   */
  const allowed = await db.transaction(async (tx) => {
    await advisoryLockOnText(tx, LOCKS.familySignIn, row.identifier);
    const [{ sent } = { sent: 0 }] = await tx
      .select({ sent: sql<number>`count(*)::int` })
      .from(familySignInsTable)
      .where(
        and(
          eq(familySignInsTable.identifier, row.identifier),
          gt(familySignInsTable.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
          sql`${familySignInsTable.codeHash} is not null`,
        ),
      );
    if (sent >= FAMILY_SIGN_INS_PER_IDENTIFIER_PER_HOUR) return false;

    await tx
      .update(familySignInsTable)
      .set({ codeHash: digest(`${challenge}:${code}`) })
      .where(eq(familySignInsTable.id, row.id));
    return true;
  });
  if (!allowed) return;

  const minutes = Math.round(FAMILY_SIGN_IN_TTL_MS / 60_000);
  try {
    if (who.kind === "email") {
      await sendFamilySignInCodeEmail({
        to: row.identifier,
        homeName: first.home.name,
        code,
        expiresInMinutes: minutes,
      });
    } else {
      // To the number on the file, which is the point. Short, names the home,
      // and says what to do if it was not them.
      await sendSms({
        to: first.contact.phone ?? row.identifier,
        body: `${first.home.name}: your code is ${code}. It works for ${minutes} minutes. If you did not ask for it, ignore this message. Reply STOP to opt out.`,
        home: first.home,
      });
    }
  } catch (err) {
    logger.warn({ err, kind: who.kind }, "Could not send a family sign-in code");
  }
}

export type SignInChoice = {
  contactId: number;
  homeName: string;
  subjectName: string;
  relationship: string | null;
};

export type SignInResult =
  | { outcome: "signed_in"; token: string }
  | { outcome: "choose"; choices: SignInChoice[] }
  | { outcome: "refused" };

function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Trade a right code for a link.
 *
 * Every way of being wrong is the same `refused`: no such request, a request
 * that has run out, a code that has been guessed at too often, a wrong code.
 * A right code for a number on several files answers `choose`, and the
 * request stays open (verified, not used) for the pick to come back on.
 */
export async function verifySignIn(
  input: { challenge: string; code?: string; contactId?: number },
  now = new Date(),
): Promise<SignInResult> {
  const refused: SignInResult = { outcome: "refused" };
  const challengeHash = digest(input.challenge);

  const [row] = await db
    .select()
    .from(familySignInsTable)
    .where(eq(familySignInsTable.challengeHash, challengeHash))
    .limit(1);

  if (!row || row.usedAt || row.expiresAt <= now) return refused;
  if (row.attempts >= FAMILY_SIGN_IN_MAX_ATTEMPTS) return refused;

  if (!row.verifiedAt) {
    // Count the try before comparing, so a burst of guesses cannot all be
    // read against the same count.
    const [counted] = await db
      .update(familySignInsTable)
      .set({ attempts: sql`${familySignInsTable.attempts} + 1` })
      .where(
        and(
          eq(familySignInsTable.id, row.id),
          eq(familySignInsTable.attempts, row.attempts),
        ),
      )
      .returning({ id: familySignInsTable.id });
    // Somebody else's guess landed first. This one is not read.
    if (!counted) return refused;

    const code = (input.code ?? "").replace(/\s/g, "");
    if (!row.codeHash || !/^\d{6}$/.test(code)) return refused;
    if (!sameDigest(row.codeHash, digest(`${input.challenge}:${code}`))) return refused;

    await db
      .update(familySignInsTable)
      .set({ verifiedAt: now })
      .where(eq(familySignInsTable.id, row.id));
  }

  const who: Identifier = { kind: row.kind as Identifier["kind"], identifier: row.identifier };
  let candidates = await candidatesFor(who);
  if (who.kind === "phone") candidates = candidates.filter((c) => !c.contact.smsOptedOutAt);
  if (candidates.length === 0) return refused;

  let chosen: Candidate | undefined;
  if (candidates.length === 1) {
    chosen = candidates[0];
  } else if (input.contactId !== undefined) {
    chosen = candidates.find((c) => c.contact.id === input.contactId);
    if (!chosen) return refused;
  } else {
    return {
      outcome: "choose",
      choices: candidates.map((c) => ({
        contactId: c.contact.id,
        homeName: c.home.name,
        subjectName: c.subjectName,
        relationship: c.contact.relationship,
      })),
    };
  }
  if (!chosen) return refused;

  // Spend the request first, and only once: two clicks on "Open" cannot mint
  // two links, the second of which would end the first.
  const [spent] = await db
    .update(familySignInsTable)
    .set({ usedAt: now })
    .where(and(eq(familySignInsTable.id, row.id), isNull(familySignInsTable.usedAt)))
    .returning({ id: familySignInsTable.id });
  if (!spent) return refused;

  const link = mintLink(now);
  // Revoked rows were filtered out above; the guard here is for one revoked
  // in the moment between.
  const [updated] = await db
    .update(familyContactsTable)
    .set({
      tokenHash: link.tokenHash,
      expiresAt: link.expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(familyContactsTable.id, chosen.contact.id),
        isNull(familyContactsTable.revokedAt),
      ),
    )
    .returning({ id: familyContactsTable.id });
  if (!updated) return refused;

  return { outcome: "signed_in", token: link.token };
}
