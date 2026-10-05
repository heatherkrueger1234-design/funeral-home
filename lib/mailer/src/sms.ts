import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import pino from "pino";
import { db, smsOptOutsTable, type FuneralHome } from "@workspace/db";

/**
 * Text messages, over Twilio's REST API.
 *
 * Called over `fetch` rather than through the Twilio SDK: the whole surface
 * is a form POST with basic auth, and swapping provider stays a change to
 * this file. Lives beside the mailer so the aftercare runner can text too.
 *
 * Every text goes through three checks, in this order:
 *  1. the caller has recorded consent for this person (see `smsBlockReason`);
 *  2. the number has not replied STOP to the sender being used;
 *  3. there is a sender at all.
 *
 * Senders, best first: the home's own 10DLC-registered messaging service
 * (subaccount), then the home's verified toll-free number, then the
 * platform's shared sender. With no credentials this logs instead of
 * sending, exactly as the mailer does.
 */

export const smsLogger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { component: "sms" },
});
const logger = smsLogger;

type Credentials = { accountSid: string; authToken: string };

function credentials(): Credentials | null {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"]?.trim();
  const authToken = process.env["TWILIO_AUTH_TOKEN"]?.trim();
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

/** The platform's own sender: a messaging service, or a single number. */
function platformSender(): { from?: string; messagingServiceSid?: string } | null {
  const messagingServiceSid = process.env["TWILIO_MESSAGING_SERVICE_SID"]?.trim();
  if (messagingServiceSid) return { messagingServiceSid };
  const from = process.env["TWILIO_FROM_NUMBER"]?.trim();
  if (from) return { from };
  return null;
}

export function isSmsConfigured(): boolean {
  return credentials() !== null && platformSender() !== null;
}

export class SmsNotSentError extends Error {
  readonly name = "SmsNotSentError";
}

/**
 * Reduce a typed phone number to something a carrier will accept.
 *
 * Conservative: strips formatting, keeps a leading `+`, and refuses anything
 * ambiguous rather than guessing — the cost of a wrong guess is a stranger
 * receiving a link to a grieving family's photographs.
 */
export function normalisePhone(
  raw: string,
  defaultCountryCode = process.env["SMS_DEFAULT_COUNTRY_CODE"] ?? "+1",
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  // E.164's own bounds.
  if (digits.length < 8 || digits.length > 15) return null;
  if (hasPlus) return `+${digits}`;

  const code = defaultCountryCode.replace(/\D/g, "");
  if (!code) return null;

  // Already carries the country code (a US number typed as 1-303-...).
  if (digits.length > 10 && digits.startsWith(code)) return `+${digits}`;

  // Seven digits is a local number; prefixing it would reach somebody else.
  if (digits.length < 10) return null;

  return `+${code}${digits}`;
}

/** `/f/<token>` → `/f/REDACTED`, for anything headed for a log. */
export function redactFamilyLink(text: string): string {
  return text.replace(/(\/f\/)[^\s/?#]+/g, "$1REDACTED");
}

/* ------------------------------------------------------------ senders --- */

type HomeSender = Pick<
  FuneralHome,
  | "id"
  | "smsSubaccountSid"
  | "smsMessagingServiceSid"
  | "smsBrandStatus"
  | "smsCampaignStatus"
  | "smsTollFreeNumber"
  | "smsTollFreeStatus"
>;

export type SmsRoute = {
  kind: "10dlc" | "toll_free" | "platform";
  /** Which STOP list applies: `home:<id>` or `platform`. */
  scope: string;
  /** The account the message is created under (a subaccount, or ours). */
  accountSid: string;
  from?: string;
  messagingServiceSid?: string;
};

/** Which sender a home's texts go from right now, or null if none. */
export function smsRouteFor(home: HomeSender | null): SmsRoute | null {
  const creds = credentials();
  if (!creds) return null;

  if (home) {
    const account = home.smsSubaccountSid?.trim() || creds.accountSid;
    if (
      home.smsMessagingServiceSid?.trim() &&
      home.smsBrandStatus === "approved" &&
      home.smsCampaignStatus === "approved"
    ) {
      return {
        kind: "10dlc",
        scope: `home:${home.id}`,
        accountSid: account,
        messagingServiceSid: home.smsMessagingServiceSid.trim(),
      };
    }
    if (home.smsTollFreeNumber?.trim() && home.smsTollFreeStatus === "verified") {
      return {
        kind: "toll_free",
        scope: `home:${home.id}`,
        accountSid: account,
        from: home.smsTollFreeNumber.trim(),
      };
    }
  }

  const shared = platformSender();
  if (!shared) return null;
  return { kind: "platform", scope: "platform", accountSid: creds.accountSid, ...shared };
}

/** Words a director can read about where their texts come from. */
export function describeSmsRoute(home: HomeSender): string {
  const route = smsRouteFor(home);
  if (!route) return "Texting is not set up on this deployment; links are copied instead.";
  if (route.kind === "10dlc") return "Texts go from your own registered number.";
  if (route.kind === "toll_free") return "Texts go from your verified toll-free number.";
  return "Texts go from the shared Continuum number until your own registration is approved.";
}

/* ---------------------------------------------------------- opt-outs --- */

export async function isOptedOut(phone: string, scope: string): Promise<boolean> {
  const [row] = await db
    .select({ id: smsOptOutsTable.id })
    .from(smsOptOutsTable)
    .where(and(eq(smsOptOutsTable.phone, phone), eq(smsOptOutsTable.scope, scope)))
    .limit(1);
  return Boolean(row);
}

export async function recordOptOut(phone: string, scope: string): Promise<void> {
  await db.insert(smsOptOutsTable).values({ phone, scope }).onConflictDoNothing();
}

export async function clearOptOut(phone: string, scope: string): Promise<void> {
  await db
    .delete(smsOptOutsTable)
    .where(and(eq(smsOptOutsTable.phone, phone), eq(smsOptOutsTable.scope, scope)));
}

/* ------------------------------------------------------------ consent --- */

/**
 * Why this person may not be texted, or null if they may. The contact's own
 * record only; the STOP list is checked again inside `sendSms`.
 */
export function smsBlockReason(contact: {
  phone: string | null;
  smsConsentAt: Date | null;
  smsOptedOutAt: Date | null;
}): string | null {
  if (!contact.phone?.trim()) return "There is no mobile number for this person.";
  if (contact.smsOptedOutAt) return "They replied STOP, so they are not texted any more.";
  if (!contact.smsConsentAt) return "They have not agreed to texts yet.";
  return null;
}

/* ------------------------------------------------------------ sending --- */

export async function sendSms(options: {
  to: string;
  body: string;
  /** The home the text is from; decides the sender and the STOP list. */
  home?: HomeSender | null;
}): Promise<{ route: SmsRoute["kind"] }> {
  const to = normalisePhone(options.to);
  if (!to) throw new SmsNotSentError("That does not look like a mobile number.");

  const creds = credentials();
  const route = smsRouteFor(options.home ?? null);

  if (!creds || !route) {
    // Outside production the body is logged, with any family link's token
    // masked out; in production, only who it was for (see the mailer's
    // `loggable`: a check-in text names the person who died).
    logger.warn(
      process.env["NODE_ENV"] === "production"
        ? { to }
        : { to, body: redactFamilyLink(options.body) },
      "Twilio is not configured — text not sent",
    );
    throw new SmsNotSentError("Text messaging is not set up on this deployment.");
  }

  /*
   * The STOP list of the sender in use, and the home's own, whichever number
   * it came through. A STOP is a request to the funeral home, not to a
   * number (the FCC's rule is about the caller), and a home's sender
   * changes: shared number while its registration is pending, its own
   * afterwards, shared again if that lapses. Checking only the sender's
   * list let a STOP given on one number be forgotten on the next.
   */
  const scopes = new Set([route.scope]);
  if (options.home?.id) {
    scopes.add(`home:${options.home.id}`);
    // A STOP given on the shared number while this home used it.
    scopes.add(`home:${options.home.id}:shared`);
  }
  for (const scope of scopes) {
    if (await isOptedOut(to, scope)) {
      throw new SmsNotSentError("This number replied STOP, so it is not texted any more.");
    }
  }

  const form = new URLSearchParams({ To: to, Body: options.body });
  if (route.messagingServiceSid) form.set("MessagingServiceSid", route.messagingServiceSid);
  else if (route.from) form.set("From", route.from);

  // The parent's credentials may act on its subaccounts.
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${route.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(creds),
      },
      body: form,
    },
  );

  if (!response.ok) {
    // Twilio's `message` says "that number is a landline", which a director
    // can act on; a bare status cannot.
    let detail = `${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; code?: number };
      if (body.message) detail = body.message;
      // 21610: the recipient replied STOP to this sender at the carrier. On
      // the shared number it is held against the home too, as a STOP that
      // reaches the webhook is, so it survives the home moving to a number
      // of its own.
      if (body.code === 21610) {
        await recordOptOut(to, route.scope);
        if (route.kind === "platform" && options.home?.id) {
          await recordOptOut(to, `home:${options.home.id}:shared`);
        }
      }
    } catch {
      /* Non-JSON error body; the status is all we have. */
    }
    logger.error({ status: response.status, detail }, "Failed to send SMS");
    throw new SmsNotSentError(detail);
  }

  logger.info({ to, route: route.kind }, "SMS sent");
  return { route: route.kind };
}

function basicAuth(creds: Credentials): string {
  return `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;
}

/* ------------------------------------------------------------ inbound --- */

/**
 * Twilio's request signature: base64 HMAC-SHA1, keyed with the auth token,
 * over the full URL followed by each POST parameter's name and value in
 * name order.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
  /** A subaccount's own token; the platform's by default. */
  authToken?: string,
): boolean {
  const token = authToken ?? credentials()?.authToken;
  if (!token || !signature) return false;
  const expected = Buffer.from(twilioSignature(token, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const subaccountTokens = new Map<string, { token: string; until: number }>();

/**
 * A home's subaccount signs the replies to its own number with its own auth
 * token, not the platform's, so checking those against the platform's token
 * refused every STOP sent to a home's registered number. The token is read
 * from Twilio with the platform's credentials (a parent may read its
 * subaccounts) and kept for an hour. Null when it cannot be had.
 */
export async function subaccountAuthToken(accountSid: string): Promise<string | null> {
  const creds = credentials();
  if (!creds || !/^AC[0-9a-f]{32}$/i.test(accountSid)) return null;
  const cached = subaccountTokens.get(accountSid);
  if (cached && cached.until > Date.now()) return cached.token;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      { headers: { Authorization: basicAuth(creds) } },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { auth_token?: string };
    if (!body.auth_token) return null;
    subaccountTokens.set(accountSid, { token: body.auth_token, until: Date.now() + 60 * 60 * 1000 });
    return body.auth_token;
  } catch {
    return null;
  }
}

export const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "REVOKE",
  "OPTOUT",
]);
export const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
export const HELP_WORDS = new Set(["HELP", "INFO"]);

export function keywordOf(body: string): "stop" | "start" | "help" | null {
  const word = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/* What a family calls our texts, and sending them. */
const TEXTS =
  "(?:texts?|txts?|messages?|msgs?|sms|notifications?|alerts?|reminders?|communications?|contact|calls|subscription)";
const SENDING =
  "(?:texting|txting|messaging|sending|contacting|calling|bothering|harassing|spamming)";
/** What can stand between a verb and the texts: "stop all of these texts". */
const BETWEEN =
  "(?:(?:all|the|these|those|this|your|ur|any|my|me|us|of|more|future|further|such|text) ){0,4}";

/** Said around a stop without changing what it means: "please stop now, thanks". */
const COURTESY = new Set([
  "please", "pls", "plz", "kindly", "just", "now", "right", "already", "again",
  "immediately", "asap", "all", "for", "good", "forever", "anymore", "permanently",
  "ok", "okay", "sorry", "thanks", "thank", "you", "thx", "ty", "hi", "hello", "hey",
]);

/**
 * Ways of saying stop that are about the texts, whatever surrounds them.
 * Each is tried on one clause at a time, so "don't." and "text me later"
 * in two sentences are not read as "don't text me".
 */
const ABOUT_THE_TEXTS: RegExp[] = [
  // Words with no other use in a reply to a text from us.
  /\bunsub(?:scrib\w*)?\b/,
  /\bopt(?:s|ed|ing)? ?(?:(?:me|us) )?out\b/,
  /\bstopall\b/,
  /\brevo(?:ke|ked|king|cation)\b/,
  /\bcease and desist\b/,
  // A stop aimed at the texts or at sending them.
  new RegExp(`\\b(?:stop|quit|cease) ${BETWEEN}(?:${TEXTS}|${SENDING})\\b`),
  // Or at "these", "this" or "them" where the clause ends: "please stop
  // these", not "we'll stop this afternoon"; and not "I can't stop them".
  new RegExp(
    `(?<!\\b(?:cant|cannot|couldnt|can not|could not) )\\b(?:stop|quit|cease) ` +
      `(?:all )?(?:of )?(?:these|this|them)(?: (?:${[...COURTESY].join("|")}))*$`,
  ),
  // Cancel and end only with the texts as their object. On their own they
  // are about the funeral -- "cancel the viewing", "when will the service
  // end" -- and "the end of your message" is not ending anything.
  new RegExp(`\\b(?:cancel|end)(?! of\\b) ${BETWEEN}${TEXTS}\\b`),
  /\b(?:texts|txts|messages|msgs|notifications|alerts|reminders|calls) to stop\b/,
  new RegExp(`\\bno more ${BETWEEN}${TEXTS}\\b`),
  new RegExp(`\\b(?:dont|do not) want (?:to (?:get|receive) )?${BETWEEN}${TEXTS}\\b`),
  /\b(?:dont|do not|never) (?:\w+ or )?(?:text|txt|message|msg|contact)(?: or \w+)? (?:me|us|this number|my number)\b/,
  /\bremove (?:me|us|my number|this number)\b/,
  /\btake (?:me|us|my number|this number) off(?:$| (?:of )?(?:this|your|ur|the) (?:\w+ )?list\b)/,
  /*
   * There is nothing else for it to mean in a reply to a text from a funeral
   * home. A family asking for time with the person who died writes "a few
   * minutes alone with Dad", not this, and on the day they would ring.
   */
  /\bleave (?:me|us) alone\b/,
];

/** A clause of nothing but one of these, give or take courtesy, is a stop. */
const ON_ITS_OWN = new Set(["stop", "quit", "cease", "end", "cancel"]);

/**
 * "Stop by", "stop in", "stop at the florist": calling in on the way, the
 * sense a family uses most in the week of a funeral.
 */
const CALLING_IN = new Set([
  "by", "in", "into", "at", "off", "over", "round", "around", "past", "on", "to", "there", "here",
]);

/**
 * A reply that withdraws consent in more words than a keyword.
 *
 * The FCC's rule (47 CFR 64.1200(a)(10)) lets consent be withdrawn by any
 * reasonable means, and its words were heard only in replies of six words or
 * fewer: "Please stop sending these, it is too painful" was answered by the
 * next text. A reply is a stop when a clause of it says so about the texts
 * ("stop sending these", "no more messages", "take me off your list"), when
 * a clause is nothing but the word ("Wrong number. Please stop."), or when
 * the reply is short and says stop or quit in any sense but calling in on
 * the way ("stop by") or being unable to ("I can't stop crying").
 *
 * Hearing a stop that was not meant is the safe mistake, because the webhook
 * answers it with how to take it back. That is also why negation is not
 * read: "if you don't stop texting me" has to stop, so "please don't stop
 * sending these" stops too, and is told to reply START. But these are
 * families arranging a funeral, and "can we stop by Thursday", "please
 * cancel the viewing" and "what time will the service end" are what they
 * write all week. So "cancel" and "end" count only as the whole reply or
 * with the texts as their object, never bare in a sentence however short.
 */
export function revokesConsent(body: string): boolean {
  if (keywordOf(body) === "stop") return true;

  const clauses = clausesOf(body);
  const words = clauses.flat();

  return (
    clauses.some(saysStop) ||
    (words.length <= 6 &&
      words.some(
        (word, i) =>
          (word === "stop" || word === "quit") &&
          !CALLING_IN.has(words[i + 1] ?? "") &&
          !unableTo(words, i),
      ))
  );
}

/** A stop typed with feeling, "STOPPPP", is a stop. */
const drawnOut = (word: string) => (/^s+t+o+p+$/.test(word) ? "stop" : word);

/**
 * The reply as clauses of bare words: lower case, without apostrophes
 * (straight or curly) or the invisible characters a phone can leave inside a
 * word, and split at the punctuation between sentences and clauses.
 */
function clausesOf(body: string): string[][] {
  return body
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")
    .replace(/['’‘ʼ]/g, "")
    .split(/[.!?,;:…\n\r–—]+/)
    .map((clause) => (clause.match(/[a-z]+/g) ?? []).map(drawnOut))
    .filter((clause) => clause.length > 0);
}

function saysStop(clause: string[]): boolean {
  const text = clause.join(" ");
  if (ABOUT_THE_TEXTS.some((pattern) => pattern.test(text))) return true;
  // "Please stop", "Cancel, thanks", "Stop it now".
  const said = clause.filter(
    (word, i) =>
      !COURTESY.has(word) && !(word === "it" && (clause[i - 1] === "stop" || clause[i - 1] === "quit")),
  );
  return said.length === 1 && ON_ITS_OWN.has(said[0]!);
}

/** "I can't stop crying" is not asking anybody to stop anything. */
function unableTo(words: string[], i: number): boolean {
  const before = words[i - 1];
  if (before === "cant" || before === "cannot" || before === "couldnt") return true;
  return before === "not" && (words[i - 2] === "can" || words[i - 2] === "could");
}

/* ----------------------------------------------------- registration --- */

/** Create a home's own Twilio subaccount. Returns its SID. */
export async function createSubaccount(friendlyName: string): Promise<string> {
  const creds = credentials();
  if (!creds) throw new SmsNotSentError("Twilio is not configured on this deployment.");
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(creds),
    },
    body: new URLSearchParams({ FriendlyName: friendlyName.slice(0, 64) }),
  });
  const body = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!response.ok || !body.sid) {
    throw new SmsNotSentError(body.message ?? `Twilio refused (${response.status}).`);
  }
  return body.sid;
}

const TWILIO_BRAND: Record<string, "pending" | "approved" | "failed"> = {
  PENDING: "pending",
  IN_REVIEW: "pending",
  APPROVED: "approved",
  FAILED: "failed",
  SUSPENDED: "failed",
};
const TWILIO_CAMPAIGN: Record<string, "pending" | "approved" | "failed"> = {
  PENDING: "pending",
  IN_PROGRESS: "pending",
  VERIFIED: "approved",
  FAILED: "failed",
};

/**
 * Ask Twilio where a home's 10DLC registration stands. Returns only what it
 * could read; unknown values leave the stored status alone.
 */
export async function fetchRegistrationStatus(home: {
  smsBrandRegistrationSid: string | null;
  smsMessagingServiceSid: string | null;
}): Promise<{ brand?: "pending" | "approved" | "failed"; campaign?: "pending" | "approved" | "failed" }> {
  const creds = credentials();
  if (!creds) return {};
  const get = async (url: string) => {
    const response = await fetch(url, { headers: { Authorization: basicAuth(creds) } });
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  };

  const result: { brand?: "pending" | "approved" | "failed"; campaign?: "pending" | "approved" | "failed" } = {};
  if (home.smsBrandRegistrationSid) {
    const brand = await get(
      `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${home.smsBrandRegistrationSid}`,
    );
    const status = TWILIO_BRAND[String(brand?.["status"] ?? "")];
    if (status) result.brand = status;
  }
  if (home.smsMessagingServiceSid) {
    const list = await get(
      `https://messaging.twilio.com/v1/Services/${home.smsMessagingServiceSid}/Compliance/Usa2p`,
    );
    const first = (list?.["compliance"] as Array<Record<string, unknown>> | undefined)?.[0];
    const status = TWILIO_CAMPAIGN[String(first?.["campaign_status"] ?? "")];
    if (status) result.campaign = status;
  }
  return result;
}
