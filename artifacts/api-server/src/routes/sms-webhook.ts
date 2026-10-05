import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, familyContactsTable, funeralHomesTable, type FuneralHome } from "@workspace/db";
import {
  clearOptOut,
  isValidTwilioSignature,
  keywordOf,
  normalisePhone,
  recordOptOut,
} from "../lib/sms";
import { HttpError } from "../lib/http";

/**
 * Replies to our texts: STOP, START and HELP.
 *
 * Twilio signs every request with the auth token over the exact URL it
 * called, so `TWILIO_WEBHOOK_URL` should be set to that URL; without it the
 * URL is rebuilt from the request, which only works behind a proxy that
 * passes the original host and scheme. Unsigned requests are refused.
 *
 * Twilio's own opt-out handling sends the carrier-required confirmation
 * text; this records the choice so nothing of ours texts the number again.
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

/** Contacts with this number, in this home (or every home, for the shared sender). */
async function contactIdsFor(phone: string, home: FuneralHome | null): Promise<number[]> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  const rows = await db
    .select({ id: familyContactsTable.id, phone: familyContactsTable.phone })
    .from(familyContactsTable)
    .where(
      and(
        sql`right(regexp_replace(coalesce(${familyContactsTable.phone}, ''), '\\D', '', 'g'), 10) = ${last10}`,
        home ? eq(familyContactsTable.funeralHomeId, home.id) : undefined,
      ),
    );
  // The SQL narrows; the normaliser decides.
  return rows.filter((r) => r.phone && normalisePhone(r.phone) === phone).map((r) => r.id);
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
  if (!isValidTwilioSignature(url, params, req.get("x-twilio-signature"))) {
    throw new HttpError(403, "That request was not signed by Twilio.");
  }

  res.type("text/xml");
  const from = params["From"] ? normalisePhone(params["From"]) : null;
  const keyword = keywordOf(params["Body"] ?? "");
  if (!from || !keyword) {
    res.send(twiml());
    return;
  }

  const home = await homeFor(params);
  const scope = home ? `home:${home.id}` : "platform";
  const now = new Date();

  if (keyword === "stop") {
    await recordOptOut(from, scope);
    const ids = await contactIdsFor(from, home);
    if (ids.length > 0) {
      await db
        .update(familyContactsTable)
        .set({ smsOptedOutAt: now, updatedAt: now })
        .where(inArray(familyContactsTable.id, ids));
    }
    req.log?.info({ scope }, "SMS opt-out recorded");
    res.send(twiml());
    return;
  }

  if (keyword === "start") {
    await clearOptOut(from, scope);
    const ids = await contactIdsFor(from, home);
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

  // HELP: who is texting them, how to reach a person, and how to stop.
  const who = home?.name ?? "Continuum Aftercare";
  const phone = home?.phone?.trim() ? ` Call ${home.phone.trim()}.` : "";
  res.send(
    twiml(
      `${who}: texts about funeral arrangements and aftercare you agreed to.${phone} Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
    ),
  );
});

export default router;
