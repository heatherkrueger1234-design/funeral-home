import { logger } from "./logger";

/**
 * Text messages, over Twilio's REST API.
 *
 * The product's entire premise is a link that arrives as a text, so leaving
 * the sending to "the director copies it and pastes it into their phone" only
 * half works: it puts the director's personal number back in the loop, which
 * is the thing the office-hours feature exists to get them out of.
 *
 * Called over `fetch` rather than through the Twilio SDK. The whole surface
 * used here is one form POST with basic auth, the SDK is a large dependency
 * on the path a family's phone number travels, and swapping to another
 * provider becomes a change to this file rather than a migration.
 *
 * With no credentials configured this logs instead of sending, exactly as the
 * mailer does, so local development and the tests work without an account.
 */

type SmsConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

function readConfig(): SmsConfig | null {
  const {
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_FROM_NUMBER: from,
  } = process.env;

  if (!accountSid || !authToken || !from) return null;

  return { accountSid, authToken, from };
}

export function isSmsConfigured(): boolean {
  return readConfig() !== null;
}

export class SmsNotSentError extends Error {
  readonly name = "SmsNotSentError";
}

/**
 * Reduce a typed phone number to something a carrier will accept.
 *
 * Deliberately conservative: it strips formatting and keeps a leading `+`,
 * and it does not try to guess a country code. A director in Denver typing
 * "(303) 555-0142" gets E.164 via `defaultCountryCode`; anything genuinely
 * ambiguous is rejected rather than sent somewhere unintended, because the
 * cost of guessing wrong is a stranger receiving a link to a grieving
 * family's photographs.
 */
export function normalisePhone(
  raw: string,
  defaultCountryCode = process.env["SMS_DEFAULT_COUNTRY_CODE"] ?? "+1",
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  // E.164's own bounds. Anything outside them is not a phone number.
  if (digits.length < 8 || digits.length > 15) return null;

  // Already fully qualified: take it as written.
  if (hasPlus) return `+${digits}`;

  const code = defaultCountryCode.replace(/\D/g, "");
  if (!code) return null;

  // Already carries the country code (a US number typed as 1-303-...).
  if (digits.length > 10 && digits.startsWith(code)) return `+${digits}`;

  /*
   * A bare number has to be a whole national number before a country code
   * can be put in front of it. Seven digits is a local number -- "555-0142"
   * -- and prefixing that yields +15550142, which is not the number the
   * director meant and may well be somebody's. Refusing is the only safe
   * answer: the cost of guessing is a link to a family's photographs
   * arriving on a stranger's phone.
   */
  if (digits.length < 10) return null;

  return `+${code}${digits}`;
}

export async function sendSms(options: {
  to: string;
  body: string;
}): Promise<void> {
  const config = readConfig();
  const to = normalisePhone(options.to);

  if (!to) {
    throw new SmsNotSentError("That does not look like a mobile number.");
  }

  if (!config) {
    logger.warn(
      { to, body: options.body },
      "Twilio is not configured — text not sent, logged instead",
    );
    throw new SmsNotSentError(
      "Text messaging is not set up on this deployment.",
    );
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${config.accountSid}:${config.authToken}`,
        ).toString("base64")}`,
      },
      body: new URLSearchParams({ To: to, From: config.from, Body: options.body }),
    },
  );

  if (!response.ok) {
    // Twilio returns a JSON body with a human-readable `message`; surfacing it
    // is the difference between "couldn't send" and "that number is a
    // landline", which is something the director can act on.
    let detail = `${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      /* Non-JSON error body; the status is all we have. */
    }

    logger.error({ status: response.status, detail }, "Failed to send SMS");
    throw new SmsNotSentError(detail);
  }

  logger.info({ to }, "SMS sent");
}
