import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  aftercareEnrollmentsTable,
  messagingConsentsTable,
  consentKey,
  mayContact,
  type ConsentSource,
  type FuneralHome,
  type MessagingChannel,
  type MessagingConsent,
} from "@workspace/db";
import { HttpError } from "./http";
import { normalisePhone, sendSms } from "./sms";
import { logger } from "./logger";

/**
 * The one door out.
 *
 * Every message this component sends goes through `sendConsentedSms`, and it
 * will not send without a live consent row. That is a slightly annoying shape
 * to work with, which is the point: the TCPA carries statutory damages per
 * message, the plaintiffs' bar that enforces it is real, and the way a
 * product acquires a texting path nobody checked is by making the unchecked
 * path the convenient one.
 *
 * The existing aftercare sender already does the careful version of this for
 * email — `pending` until the family says yes, consent re-read at send time,
 * `unsubscribedAt` final. Nothing here weakens any of that; this is the same
 * pattern applied to the channel that can bill by the message.
 */

/** A phone number in the form this module stores and sends to. */
export function storableAddress(
  channel: MessagingChannel,
  raw: string,
): string | null {
  if (channel === "email") {
    const trimmed = raw.trim();
    return trimmed ? consentKey("email", trimmed) : null;
  }

  const normalised = normalisePhone(raw);
  return normalised ? consentKey("sms", normalised) : null;
}

export async function consentFor(
  funeralHomeId: number,
  channel: MessagingChannel,
  address: string,
): Promise<MessagingConsent | undefined> {
  const key = storableAddress(channel, address);
  if (!key) return undefined;

  const [row] = await db
    .select()
    .from(messagingConsentsTable)
    .where(
      and(
        eq(messagingConsentsTable.funeralHomeId, funeralHomeId),
        eq(messagingConsentsTable.channel, channel),
        eq(messagingConsentsTable.address, key),
      ),
    )
    .limit(1);

  return row;
}

/** Whether a message may be sent to this address on behalf of this home. */
export async function maySendTo(
  funeralHomeId: number,
  channel: MessagingChannel,
  address: string,
): Promise<boolean> {
  return mayContact(await consentFor(funeralHomeId, channel, address));
}

export type RecordConsentInput = {
  funeralHomeId: number;
  channel: MessagingChannel;
  address: string;
  source: ConsentSource;
  sourceDetail?: string | null;
  caseId?: number | null;
  contactId?: number | null;
  recordedByUserId?: number | null;
  now?: Date;
};

/**
 * Write down that somebody said yes.
 *
 * A revoked row is never revived here, and the refusal is the feature. Once
 * a person has sent STOP, no screen in this product may put them back on a
 * list — not a director ticking a box, not the family portal, not a fresh
 * case six months later. The way back is a telephone call to the home and a
 * human deciding, which is how a funeral home does everything else, and it
 * leaves the record showing that the stop was honoured throughout.
 */
export async function recordConsent(
  input: RecordConsentInput,
): Promise<MessagingConsent> {
  const key = storableAddress(input.channel, input.address);

  if (!key) {
    throw new HttpError(
      400,
      input.channel === "sms"
        ? "That does not look like a mobile number."
        : "That does not look like an email address.",
    );
  }

  const now = input.now ?? new Date();
  const existing = await consentFor(input.funeralHomeId, input.channel, key);

  if (existing?.revokedAt) {
    throw new HttpError(
      409,
      input.channel === "sms"
        ? "This number asked us to stop texting, so we will not text it again. If they have changed their mind, please ring them."
        : "This address asked us to stop writing, so we will not write to it again. If they have changed their mind, please ring them.",
    );
  }

  if (existing) return existing;

  const [created] = await db
    .insert(messagingConsentsTable)
    .values({
      funeralHomeId: input.funeralHomeId,
      caseId: input.caseId ?? null,
      contactId: input.contactId ?? null,
      channel: input.channel,
      address: key,
      grantedAt: now,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      recordedByUserId: input.recordedByUserId ?? null,
    })
    /*
     * Two people recording the same yes at once is not an error worth
     * showing anybody. The row that exists already says the same thing.
     */
    .onConflictDoNothing({
      target: [
        messagingConsentsTable.funeralHomeId,
        messagingConsentsTable.channel,
        messagingConsentsTable.address,
      ],
    })
    .returning();

  if (created) return created;

  return (await consentFor(input.funeralHomeId, input.channel, key))!;
}

/**
 * Every live enrolment reachable at an address.
 *
 * Matched in JavaScript rather than by an equality in SQL, because the two
 * sides are not stored the same way: a director types "(303) 555-0142" into
 * a contact and that is what an enrolment copies, while a stop arrives from
 * a carrier as +13035550142. Comparing them as written silently matches
 * nothing, which is the failure where somebody keeps receiving grief email
 * after asking us to stop.
 *
 * The set it scans is the enrolments that could still be written to, which
 * for a funeral home is hundreds and for the platform is not a scale this
 * needs to be clever about. If it ever is, the fix is normalising the column
 * on the way in, not a regular expression in a predicate.
 */
async function liveEnrollmentsAt(
  channel: MessagingChannel,
  key: string,
): Promise<{ id: number; funeralHomeId: number }[]> {
  const rows = await db
    .select({
      id: aftercareEnrollmentsTable.id,
      funeralHomeId: aftercareEnrollmentsTable.funeralHomeId,
      email: aftercareEnrollmentsTable.email,
      phone: aftercareEnrollmentsTable.phone,
    })
    .from(aftercareEnrollmentsTable)
    .where(isNull(aftercareEnrollmentsTable.unsubscribedAt));

  return rows
    .filter((row) => {
      const stored = channel === "sms" ? row.phone : row.email;
      return stored ? storableAddress(channel, stored) === key : false;
    })
    .map(({ id, funeralHomeId }) => ({ id, funeralHomeId }));
}

/**
 * STOP, honoured everywhere at once.
 *
 * Deliberately not scoped to the home the message came from. A person who
 * texts STOP is telling us to stop, not telling one tenant to stop; and in
 * the one case where the same number is on two homes' lists — a family that
 * used two funeral homes, which happens more than you would think — asking
 * them to send it twice is indefensible. Over-revoking costs a home one
 * message it wanted to send. Under-revoking costs it 500 dollars a message.
 *
 * Aftercare goes with it, because the promise is "across every message
 * type". An enrolment matched by address gets the same final
 * `unsubscribedAt` the family portal writes, and nothing anywhere sets it
 * back.
 */
export async function honourStop(
  channel: MessagingChannel,
  address: string,
  reason: string,
  now = new Date(),
): Promise<{ consents: number; enrollments: number }> {
  const key = storableAddress(channel, address);
  if (!key) return { consents: 0, enrollments: 0 };

  const matched = await liveEnrollmentsAt(channel, key);

  const consents = await db
    .update(messagingConsentsTable)
    .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
    .where(
      and(
        eq(messagingConsentsTable.channel, channel),
        eq(messagingConsentsTable.address, key),
        isNull(messagingConsentsTable.revokedAt),
      ),
    )
    .returning({ id: messagingConsentsTable.id });

  /*
   * An address that was never granted still has to be able to stop things.
   * Somebody reached by a path that predates this component sends STOP to
   * the same number, so a revoked row is written even where there was no
   * grant — it is what `mayContact` reads the next time anything tries, and
   * it is what makes a later "record consent" refuse.
   */
  for (const homeId of new Set(matched.map((row) => row.funeralHomeId))) {
    await db
      .insert(messagingConsentsTable)
      .values({
        funeralHomeId: homeId,
        channel,
        address: key,
        source: "reply",
        sourceDetail: "Never granted; recorded so the stop is permanent.",
        revokedAt: now,
        revokedReason: reason,
      })
      .onConflictDoNothing({
        target: [
          messagingConsentsTable.funeralHomeId,
          messagingConsentsTable.channel,
          messagingConsentsTable.address,
        ],
      });
  }

  let enrollments = 0;

  for (const row of matched) {
    await db
      .update(aftercareEnrollmentsTable)
      .set({ status: "done", unsubscribedAt: now, updatedAt: now })
      .where(
        and(
          eq(aftercareEnrollmentsTable.id, row.id),
          isNull(aftercareEnrollmentsTable.unsubscribedAt),
        ),
      );
    enrollments += 1;
  }

  logger.info(
    { channel, consents: consents.length, enrollments },
    "Honoured a stop request",
  );

  return { consents: consents.length, enrollments };
}

export class ConsentMissingError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

/**
 * The only way anything in this component sends a text.
 *
 * Three things happen here that must not be skippable, which is why there is
 * no second path:
 *
 *  1. Consent is read **now**, not when the message was queued. Somebody who
 *     stopped last week must not receive something scheduled a month ago.
 *  2. The message names the home. A link arriving from an unknown number
 *     three days after a death reads like a scam unless it says who it is,
 *     and the TCPA requires the sender to be identified in any case.
 *  3. Every message carries the way out. A person who cannot find how to
 *     stop will find the regulator instead.
 */
export async function sendConsentedSms(options: {
  home: Pick<FuneralHome, "id" | "name" | "aftercareSenderName">;
  to: string;
  body: string;
  caseId?: number | null;
  contactId?: number | null;
}): Promise<void> {
  const consent = await consentFor(options.home.id, "sms", options.to);

  if (!mayContact(consent)) {
    throw new ConsentMissingError(
      consent?.revokedAt
        ? "This number asked us to stop texting. Please ring them instead."
        : "We have no record of this number agreeing to be texted. Ask them first, then record it here.",
    );
  }

  const brand = options.home.aftercareSenderName?.trim() || options.home.name;

  await sendSms({
    to: options.to,
    body: `${brand}: ${options.body} Reply STOP to stop.`,
  });
}
