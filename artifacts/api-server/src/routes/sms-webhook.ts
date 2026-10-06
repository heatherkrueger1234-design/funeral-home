import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  aftercareEnrollmentsTable,
  db,
  familyContactsTable,
  funeralHomesTable,
  type FuneralHome,
} from "@workspace/db";
import {
  clearOptOut,
  isOptedOut,
  isValidTwilioSignature,
  keywordOf,
  normalisePhone,
  recordOptOut,
  revokesConsent,
  subaccountAuthToken,
} from "../lib/sms";
import { HttpError } from "../lib/http";

/**
 * Replies to our texts: STOP, START and HELP, and everything else.
 *
 * Twilio signs every request with the auth token over the exact URL it
 * called, so `TWILIO_WEBHOOK_URL` should be set to that URL; without it the
 * URL is rebuilt from the request, which only works behind a proxy that
 * passes the original host and scheme. Unsigned requests are refused. A
 * reply to a home's own registered number is signed by that home's
 * subaccount, and checked against its token.
 *
 * Twilio's own opt-out handling sends the carrier-required confirmation
 * for an exact keyword; this records the choice so nothing of ours texts
 * the number again. When Twilio has answered (`OptOutType` is set), nothing
 * here answers a second time.
 */
const router: IRouter = Router();

const escapeXml = (text: string) =>
  text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function twiml(message?: string): string {
  return message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

/** Which home's sender the reply came to, if it was one of theirs. */
async function homeFor(params: Record<string, string>): Promise<FuneralHome | null> {
  const service = params["MessagingServiceSid"]?.trim();
  const account = params["AccountSid"]?.trim();
  const to = params["To"] ? normalisePhone(params["To"]) : null;
  const parent = process.env["TWILIO_ACCOUNT_SID"]?.trim();

  const matches = [
    service ? eq(funeralHomesTable.smsMessagingServiceSid, service) : null,
    account && account !== parent ? eq(funeralHomesTable.smsSubaccountSid, account) : null,
    to ? eq(funeralHomesTable.smsTollFreeNumber, to) : null,
  ].filter((m) => m !== null);
  if (matches.length === 0) return null;

  const [home] = await db.select().from(funeralHomesTable).where(or(...matches)).limit(1);
  return home ?? null;
}

/** Every home that has this number as a contact, or texts it check-ins. */
async function homeIdsOf(phone: string): Promise<number[]> {
  const contacts = await contactsWith(phone, null);
  return [
    ...new Set([...contacts.map((contact) => contact.homeId), ...(await enrolledHomesWith(phone))]),
  ];
}

/*
 * The mobile a family gives for check-in texts is kept on the enrolment, not
 * the contact, and need not be the number the director has. A STOP from it on
 * the shared number matched no contact, so it was held against the shared
 * number alone, and the texts started again the day the home's own number
 * was approved.
 */
async function enrolledHomesWith(phone: string): Promise<number[]> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  const rows = await db
    .select({
      homeId: aftercareEnrollmentsTable.funeralHomeId,
      phone: aftercareEnrollmentsTable.phone,
    })
    .from(aftercareEnrollmentsTable)
    .where(
      sql`right(regexp_replace(coalesce(${aftercareEnrollmentsTable.phone}, ''), '\\D', '', 'g'), 10) = ${last10}`,
    );
  // The SQL narrows; the normaliser decides, as for contacts.
  return rows.filter((r) => r.phone && normalisePhone(r.phone) === phone).map((r) => r.homeId);
}

/*
 * A STOP given on the shared number is held against each home this person
 * hears from, under its own name, so that it holds when the home moves to a
 * number of its own (`sendSms` checks it) — and so that a START on the
 * shared number can take back exactly what a STOP there put down, and not a
 * STOP the person gave to some home's own number.
 */
const viaShared = (homeId: number) => `home:${homeId}:shared`;

/**
 * The home a reply to the shared number is really about, when only one home
 * has this person as a contact. Their HELP is answered with that home's name
 * and telephone rather than ours, which is who they need.
 */
async function onlyHomeOf(phone: string): Promise<FuneralHome | null> {
  const homes = await homeIdsOf(phone);
  if (homes.length !== 1) return null;
  const [home] = await db
    .select()
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.id, homes[0]!))
    .limit(1);
  return home ?? null;
}

/**
 * Who answered, recently, with "this number can't take replies". Once in
 * twelve hours per number is enough to tell somebody where to go; a family
 * writing five messages in a row does not need five of the same answer. In
 * memory, so a restart forgets — the cost of that is one extra reply.
 */
const pointedAt = new Map<string, number>();
const POINTER_GAP_MS = 12 * 60 * 60 * 1000;

/** Contacts with this number, in this home (or every home, for the shared sender). */
async function contactsWith(
  phone: string,
  home: FuneralHome | null,
): Promise<Array<{ id: number; homeId: number }>> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  const rows = await db
    .select({
      id: familyContactsTable.id,
      homeId: familyContactsTable.funeralHomeId,
      phone: familyContactsTable.phone,
    })
    .from(familyContactsTable)
    .where(
      and(
        sql`right(regexp_replace(coalesce(${familyContactsTable.phone}, ''), '\\D', '', 'g'), 10) = ${last10}`,
        home ? eq(familyContactsTable.funeralHomeId, home.id) : undefined,
      ),
    );
  // The SQL narrows; the normaliser decides.
  return rows
    .filter((r) => r.phone && normalisePhone(r.phone) === phone)
    .map(({ id, homeId }) => ({ id, homeId }));
}

async function contactIdsFor(phone: string, home: FuneralHome | null): Promise<number[]> {
  return (await contactsWith(phone, home)).map((contact) => contact.id);
}

router.post("/webhooks/twilio/sms", async (req, res) => {
  if (!process.env["TWILIO_AUTH_TOKEN"]?.trim()) {
    throw new HttpError(503, "Texting is not set up on this deployment.");
  }

  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string") params[key] = value;
  }

  const url =
    process.env["TWILIO_WEBHOOK_URL"]?.trim() ||
    `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const signature = req.get("x-twilio-signature");
  if (!(await isSignedByTwilio(url, params, signature))) {
    throw new HttpError(403, "That request was not signed by Twilio.");
  }

  res.type("text/xml");
  const from = params["From"] ? normalisePhone(params["From"]) : null;
  if (!from) {
    res.send(twiml());
    return;
  }
  const body = params["Body"] ?? "";
  const keyword = keywordOf(body);
  // Twilio's Advanced Opt-Out has already answered this keyword itself.
  const twilioAnswered = Boolean(params["OptOutType"]?.trim());

  const home = await homeFor(params);
  const scope = home ? `home:${home.id}` : "platform";
  const now = new Date();

  if (keyword === "stop" || (!keyword && revokesConsent(body))) {
    await recordOptOut(from, scope);
    // On the shared number, the STOP is also to every home this person
    // hears from (`viaShared`).
    for (const homeId of home ? [] : await homeIdsOf(from)) {
      await recordOptOut(from, viaShared(homeId));
    }
    const ids = await contactIdsFor(from, home);
    if (ids.length > 0) {
      await db
        .update(familyContactsTable)
        .set({ smsOptedOutAt: now, updatedAt: now })
        .where(inArray(familyContactsTable.id, ids));
    }
    req.log?.info({ scope, exact: keyword === "stop" }, "SMS opt-out recorded");
    // An exact keyword is confirmed by Twilio. "Stop please" is not one of
    // Twilio's, so the confirmation — and the way back — is ours to send.
    const who = home?.name ?? (await onlyHomeOf(from))?.name ?? "Continuum Aftercare";
    res.send(
      keyword === "stop" || twilioAnswered
        ? twiml()
        : twiml(`${who}: you won't get any more texts from us. Reply START if that was a mistake.`),
    );
    return;
  }

  if (keyword === "start") {
    /*
     * A START takes back what a STOP to the same number put down, and no
     * more. To a home's own number: that home's lists and its contacts. To
     * the shared number: the shared list, the STOPs it held against each
     * home, and the contacts at homes this person has not also stopped on
     * their own number — a "yes" to one home on the shared number must not
     * undo a STOP they sent to another.
     */
    let ids: number[];
    if (home) {
      await clearOptOut(from, scope);
      await clearOptOut(from, viaShared(home.id));
      ids = await contactIdsFor(from, home);
    } else {
      await clearOptOut(from, scope);
      const released = new Set<number>();
      for (const homeId of await homeIdsOf(from)) {
        await clearOptOut(from, viaShared(homeId));
        if (!(await isOptedOut(from, `home:${homeId}`))) released.add(homeId);
      }
      ids = (await contactsWith(from, null))
        .filter((contact) => released.has(contact.homeId))
        .map((contact) => contact.id);
    }
    if (ids.length > 0) {
      await db
        .update(familyContactsTable)
        .set({ smsOptedOutAt: null, updatedAt: now })
        .where(inArray(familyContactsTable.id, ids));
      // Texting START is consent in its own right, for anyone without one.
      await db
        .update(familyContactsTable)
        .set({ smsConsentAt: now, smsConsentSource: "reply_start" })
        .where(and(inArray(familyContactsTable.id, ids), isNull(familyContactsTable.smsConsentAt)));
    }
    req.log?.info({ scope }, "SMS opt-in recorded");
    res.send(twiml());
    return;
  }

  // Who they hear from: the home whose number this is, or on the shared
  // number the one home that has them as a contact.
  const sender = home ?? (await onlyHomeOf(from));
  const who = sender?.name ?? "Continuum Aftercare";
  const call = sender?.phone?.trim() ? sender.phone.trim() : null;

  if (keyword === "help") {
    if (twilioAnswered) {
      res.send(twiml());
      return;
    }
    // Who is texting them, how to reach a person, and how to stop.
    const reach = call
      ? ` Call ${call}.`
      : " For help, contact the funeral home that sent you the link.";
    res.send(
      twiml(
        `${who}: texts about funeral arrangements and aftercare you agreed to.${reach} Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
      ),
    );
    return;
  }

  /*
   * Anything else is somebody writing to the funeral home — "what time on
   * Thursday?" — to a number nobody reads. It used to vanish without a word,
   * leaving them waiting on an answer that could never come. Now they are
   * told, once in a while, where a person is. Nothing they wrote is logged,
   * and somebody who has asked not to be texted is not sent even this.
   */
  const last = pointedAt.get(from) ?? 0;
  if (now.getTime() - last < POINTER_GAP_MS || (await isOptedOut(from, scope))) {
    res.send(twiml());
    return;
  }
  if (pointedAt.size > 10_000) {
    for (const [number, at] of pointedAt) {
      if (now.getTime() - at >= POINTER_GAP_MS) pointedAt.delete(number);
    }
  }
  pointedAt.set(from, now.getTime());
  req.log?.info({ scope }, "SMS reply pointed to the home");
  const reach = call
    ? `To reach us, call ${call}, or write to us on your private page.`
    : "To reach the funeral home, write to them on your private page.";
  res.send(twiml(`${who}: this number can't take replies. ${reach} Reply STOP to stop texts.`));
});

/**
 * Signed with the platform's token, or — for a reply to a home's own
 * registered number — with that home's subaccount token. The account is
 * only believed after the signature is: an `AccountSid` that names a real
 * home but was not signed with its token is refused like any forgery.
 */
async function isSignedByTwilio(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): Promise<boolean> {
  if (isValidTwilioSignature(url, params, signature)) return true;

  const account = params["AccountSid"]?.trim();
  const parent = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  if (!account || account === parent) return false;
  const [owner] = await db
    .select({ id: funeralHomesTable.id })
    .from(funeralHomesTable)
    .where(eq(funeralHomesTable.smsSubaccountSid, account))
    .limit(1);
  if (!owner) return false;

  const token = await subaccountAuthToken(account);
  return token !== null && isValidTwilioSignature(url, params, signature, token);
}

export default router;
