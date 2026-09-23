import nodemailer, { type Transporter } from "nodemailer";
import pino from "pino";

/**
 * Its own logger rather than the API server's.
 *
 * This package is used by the server and by the aftercare worker, which is a
 * plain script with no request context. Reaching back into the server's
 * logger would make the worker depend on the whole HTTP stack to send an
 * email.
 */
const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { component: "mailer" },
});

/**
 * Outbound email, over plain SMTP.
 *
 * Deliberately not tied to one provider. Gmail works today with an app
 * password; Resend, Postmark, SendGrid and Fastmail all speak the same
 * protocol, so outgrowing Google's sending limits is a settings change rather
 * than a rewrite. The only thing this file knows is host, port and
 * credentials.
 *
 * With no SMTP settings configured the transport logs the message instead of
 * sending it. That keeps local development and the test suite working without
 * credentials, and it is why `sendPasswordResetEmail` is safe to call before
 * email is set up — the reset link appears in the server log rather than
 * silently failing.
 */

type MailerConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** The address inside `from`, without any display name around it. */
  fromAddress: string;
};

/** "Name <a@b.com>" -> "a@b.com"; a bare address comes back as it is. */
function bareAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
}

/**
 * Why mail cannot go out, in words an operator can act on, or null when the
 * settings are complete (or deliberately absent).
 *
 * The two mistakes this catches both used to fail silently. Setting two of
 * the three SMTP variables — a typo in one name is enough — fell back to
 * writing mail to the log, so password resets simply never arrived. And with
 * no SMTP_FROM the sender defaulted to SMTP_USER, which for Postmark,
 * SendGrid and Resend is an API key or the word "apikey": every message then
 * went out from an address that is not one, and the provider refused it.
 */
function readConfig():
  | { config: MailerConfig; problem: null }
  | { config: null; problem: string | null } {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  const required = { SMTP_HOST, SMTP_USER, SMTP_PASS };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length === 3) return { config: null, problem: null };
  if (missing.length > 0) {
    return {
      config: null,
      problem:
        `SMTP is half configured: ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set, so no email will be sent.`,
    };
  }

  const port = Number(SMTP_PORT || 587);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer, got "${SMTP_PORT}"`);
  }

  const from = SMTP_FROM || SMTP_USER!;
  if (!from.includes("@")) {
    return {
      config: null,
      problem:
        `SMTP_FROM is not set, and SMTP_USER ("${SMTP_USER}") is not an email ` +
        "address, so there is no sender to put on the message. Set SMTP_FROM " +
        'to the address families should see, e.g. "Willowbank Funeral Home ' +
        '<care@willowbank.example>", on a domain the provider has verified.',
    };
  }

  return {
    config: {
      host: SMTP_HOST!,
      port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: port === 465,
      user: SMTP_USER!,
      pass: SMTP_PASS!,
      from,
      fromAddress: bareAddress(from),
    },
    problem: null,
  };
}

type Mailer = { transport: Transporter; from: string; fromAddress: string };

let cached: Mailer | null | undefined;

function getTransport(): Mailer | null {
  if (cached !== undefined) return cached;

  const { config, problem } = readConfig();

  if (!config) {
    if (problem) logger.error(problem);
    else
      logger.warn(
        "SMTP is not configured. Password reset emails will be written to this " +
          "log instead of sent. Set SMTP_HOST, SMTP_USER and SMTP_PASS to send them.",
      );
    cached = null;
    return cached;
  }

  cached = {
    transport: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Port 587 is the submission port, and every provider that listens on
      // it offers STARTTLS. Insisting on it means a connection that has had
      // STARTTLS stripped out fails instead of sending the password in clear.
      requireTLS: config.port === 587,
      auth: { user: config.user, pass: config.pass },
    }),
    from: config.from,
    fromAddress: config.fromAddress,
  };

  return cached;
}

/**
 * Check the settings from end to end: connect, authenticate, and send one
 * message to `to`. Throws with the provider's own explanation on any step,
 * which is the point — this is what `send-test-email` runs, so that a wrong
 * password is found by whoever is setting the server up, not by a director
 * who cannot reset theirs.
 */
export async function sendTestEmail(to: string): Promise<{
  host: string;
  port: number;
  from: string;
}> {
  const { config, problem } = readConfig();
  if (!config) {
    throw new MailNotSentError(
      problem ??
        "SMTP is not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.",
    );
  }

  const mailer = getTransport()!;
  try {
    await mailer.transport.verify();
  } catch (err) {
    throw new MailNotSentError(
      `Could not sign in to ${config.host}:${config.port}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  await send({
    to,
    subject: "Test email from your funeral home software",
    text:
      "If you are reading this, email is set up correctly: password resets, " +
      "staff invitations and aftercare check-ins will be delivered.\n\n" +
      `Sent through ${config.host}:${config.port} as ${config.from}.`,
    html:
      "<p>If you are reading this, email is set up correctly: password resets, " +
      "staff invitations and aftercare check-ins will be delivered.</p>" +
      `<p style="color:#5f645d">Sent through ${esc(config.host)}:${config.port} ` +
      `as ${esc(config.from)}.</p>`,
    rethrow: true,
  });

  return { host: config.host, port: config.port, from: config.from };
}

/** True when real email can actually go out. Exposed for the health check. */
export function isMailConfigured(): boolean {
  return getTransport() !== null;
}

/** Raised only by `send({ rethrow: true })`. */
export class MailNotSentError extends Error {
  readonly name = "MailNotSentError";
}

/**
 * Escape a value before it goes into the HTML half of an email.
 *
 * Every string these templates interpolate came from a person: a home's own
 * name, a director's display name, an aftercare body a home wrote, and -- once
 * the public front door exists -- a note typed by a stranger who has never
 * authenticated with anything. Building HTML by interpolation without this is
 * how a name containing a tag becomes markup in a director's inbox.
 *
 * Mail clients strip most of what could be injected, which is exactly why this
 * was easy to leave out and why leaving it out is not defensible: "the
 * recipient's software will probably clean up after us" is not a security
 * boundary we control.
 *
 * Single quotes are escaped too, because these templates use both quoting
 * styles for attributes.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Mask the single-use token out of a reset/invite link before it goes
 * anywhere logs might end up (an aggregator, a support ticket, a sidecar).
 * The link only ever needs to be readable end-to-end when it's actually
 * emailed to the account holder.
 */
function redactToken(url: string): string {
  return url.replace(/([?&]token=)[^&\s]+/i, "$1REDACTED");
}

async function send(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * What to log in place of `text` when SMTP isn't configured and the
   * message would otherwise be written to the log. Defaults to `text`.
   * Set this whenever `text` embeds a working credential (a reset or
   * invite link) so the fallback path can't leak it into logs.
   */
  logText?: string;
  /**
   * Report failure to the caller instead of swallowing it.
   *
   * Off by default, because `/auth/forgot-password` must answer identically
   * whatever happens — a provider outage there would otherwise become a
   * signal about which addresses have accounts. The aftercare worker is the
   * opposite case: it has to know a send failed so it can record it against
   * the delivery rather than mark it sent and move on.
   */
  rethrow?: boolean;
  /**
   * Whose name the recipient sees as the sender. The address stays
   * SMTP_FROM's own, because that is the domain SPF and DKIM vouch for; a
   * home's name on the platform's address is what lands in the inbox, a
   * home's own address from the platform's servers is what lands in spam.
   */
  senderName?: string;
  /** Where a reply goes, when it should not come back to SMTP_FROM. */
  replyTo?: string | null;
  /** Extra headers, e.g. List-Unsubscribe on a grief check-in. */
  headers?: Record<string, string>;
}): Promise<void> {
  const mailer = getTransport();

  if (!mailer) {
    logger.warn(
      {
        to: message.to,
        subject: message.subject,
        body: message.logText ?? message.text,
      },
      "SMTP not configured — email not sent, logged instead",
    );
    if (message.rethrow) {
      throw new MailNotSentError("SMTP is not configured on this deployment.");
    }
    return;
  }

  try {
    const { rethrow, logText, senderName, replyTo, headers, ...payload } = message;
    void rethrow;
    void logText;
    await mailer.transport.sendMail({
      // As an object, not a formatted string, so nodemailer quotes the name:
      // "Horan & McConaty, Ltd" would otherwise be read as two addresses.
      from: senderName?.trim()
        ? { name: senderName.trim(), address: mailer.fromAddress }
        : mailer.from,
      ...(replyTo ? { replyTo } : {}),
      ...(headers ? { headers } : {}),
      ...payload,
    });
    logger.info({ to: message.to, subject: message.subject }, "Email sent");
  } catch (err) {
    // Never rethrow to the caller: /auth/forgot-password must answer the same
    // way whatever happens, and a provider outage must not become a signal
    // about whether an account exists.
    logger.error({ err, to: message.to }, "Failed to send email");

    if (message.rethrow) {
      throw new MailNotSentError(
        err instanceof Error ? err.message : "The mail server refused it.",
      );
    }
  }
}

export async function sendPasswordResetEmail(options: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<void> {
  const { to, resetUrl, expiresInMinutes } = options;

  const text = [
    "Someone asked to reset the password for your Holding Today account.",
    "",
    "Open this link to choose a new one:",
    resetUrl,
    "",
    `The link works once, and expires in ${expiresInMinutes} minutes.`,
    "",
    "If this wasn't you, you can ignore this email — nothing has changed, and",
    "no one has been able to sign in.",
    "",
    "— Holding Today",
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 20px">
    Someone asked to reset the password for your Holding&nbsp;Today account.
  </p>
  <p style="margin:0 0 28px">
    <a href="${esc(resetUrl)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Choose a new password</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link works once, and expires in ${expiresInMinutes} minutes.
    If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${esc(resetUrl)}</span>
  </p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">
    If this wasn't you, you can ignore this email — nothing has changed, and
    no one has been able to sign in.
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— Holding Today</p>
</div>`.trim();

  await send({
    to,
    subject: "Reset your Holding Today password",
    text,
    html,
    logText: text.replace(resetUrl, redactToken(resetUrl)),
  });
}

export async function sendStaffInviteEmail(options: {
  to: string;
  homeName: string;
  invitedBy: string;
  inviteLink: string;
  expiresInMinutes: number;
}): Promise<void> {
  const { to, homeName, invitedBy, inviteLink, expiresInMinutes } = options;

  const text = [
    `${invitedBy} has added you to ${homeName} on Holding Today.`,
    "",
    "Choose a password to get in:",
    inviteLink,
    "",
    `The link works once, and expires in ${expiresInMinutes} minutes. Ask`,
    "them to send another if it runs out.",
    "",
    "— Holding Today",
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 20px">
    ${esc(invitedBy)} has added you to <strong>${esc(homeName)}</strong> on Holding&nbsp;Today.
  </p>
  <p style="margin:0 0 28px">
    <a href="${esc(inviteLink)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Choose a password</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link works once and expires in ${expiresInMinutes} minutes. If the
    button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${esc(inviteLink)}</span>
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— Holding Today</p>
</div>`.trim();

  await send({
    to,
    subject: `You've been added to ${homeName}`,
    text,
    html,
    logText: text.replace(inviteLink, redactToken(inviteLink)),
  });
}

/**
 * A relative's own link to the family's page, sent because somebody in the
 * family asked for them to have one.
 *
 * It names both the home and the relative who asked, in the first line,
 * because a link to "the arrangements" arriving from an unknown address a
 * few days after a death reads like a scam unless it says who it is from and
 * who they know. It does not name the person who died: the subject line of
 * an email is shown on lock screens and in shared inboxes, and that news may
 * not have reached everyone who can see this one.
 *
 * Throws `MailNotSentError` when it cannot go, so the caller can fall back to
 * showing the link once to copy. The link is the credential, so it is never
 * written to the log in the clear.
 */
export async function sendFamilyLinkEmail(options: {
  to: string;
  homeName: string;
  invitedBy: string;
  link: string;
  replyTo?: string | null;
}): Promise<void> {
  const { to, homeName, invitedBy, link, replyTo } = options;

  const text = [
    `${invitedBy} asked ${homeName} to send you this.`,
    "",
    "It is your own private page for the funeral arrangements, where the",
    "family is sharing photographs, the order of service and the plans for",
    "the day. You can add photographs and memories there too, if you would",
    "like to.",
    "",
    link,
    "",
    "The link is yours alone. Nothing needs setting up, and nothing needs",
    "doing today.",
    "",
    `— ${homeName}`,
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 16px">
    ${esc(invitedBy)} asked <strong>${esc(homeName)}</strong> to send you this.
  </p>
  <p style="margin:0 0 24px">
    It is your own private page for the funeral arrangements, where the family
    is sharing photographs, the order of service and the plans for the day.
    You can add photographs and memories there too, if you would like to.
  </p>
  <p style="margin:0 0 24px">
    <a href="${esc(link)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Open the page</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link is yours alone. Nothing needs setting up, and nothing needs doing
    today. If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${esc(link)}</span>
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— ${esc(homeName)}</p>
</div>`.trim();

  await send({
    to,
    subject: `${invitedBy} shared the arrangements with you`,
    text,
    html,
    logText: text.replace(link, link.replace(/\/f\/[^/\s?#]+/, "/f/REDACTED")),
    senderName: homeName,
    replyTo,
    rethrow: true,
  });
}

/**
 * A grief check-in.
 *
 * Plain text with a minimal HTML twin, and no images, tracking pixel or
 * unsubscribe-tracking link. This lands in somebody's inbox on the
 * anniversary of their mother's death; it should look like a note from their
 * funeral director, because that is what it is, and not like a campaign.
 *
 * Throws on failure so the worker can record it rather than assume it landed.
 */
export async function sendAftercareEmail(options: {
  to: string;
  subject: string;
  body: string;
  brandedAs: string;
  /**
   * The home's own inbox. A family who answers "thank you, it was a hard
   * week" is writing to their funeral director, and that is who should read
   * it, not a no-reply mailbox at the software company.
   */
  replyTo?: string | null;
  /**
   * Where "stop these" goes: a page on the portal that asks once and then
   * stops them for good. Null when the deployment has no FAMILY_PORTAL_URL,
   * in which case the note says to reply, which reaches the home.
   */
  unsubscribeUrl?: string | null;
  /** The RFC 8058 one-click endpoint, for the mail client's own button. */
  oneClickUnsubscribeUrl?: string | null;
  /** The home's postal address, which CAN-SPAM asks every message to carry. */
  postalAddress?: string | null;
}): Promise<void> {
  const {
    to,
    subject,
    body,
    brandedAs,
    replyTo,
    unsubscribeUrl,
    oneClickUnsubscribeUrl,
    postalAddress,
  } = options;

  /*
   * The foot of the note. Quiet, and in the same grey as the signature, but
   * present: a family who cannot face another of these should not have to
   * find a text message from last spring to make them stop.
   */
  const stopLine = unsubscribeUrl
    ? `If you would rather not hear from us like this, you can stop these notes here: ${unsubscribeUrl}`
    : "If you would rather not hear from us like this, reply to this note and we will stop.";

  const text = [
    body,
    "",
    `— Provided in care with ${brandedAs}`,
    ...(postalAddress ? [postalAddress] : []),
    "",
    stopLine,
  ].join("\n");

  // Escaped first, then the single line break the home typed is turned into
  // the one tag this template allows. Doing it the other way round would let
  // the escaping swallow the <br> it had just produced.
  const paragraphs = body
    .split("\n\n")
    .map(
      (para) =>
        `<p style="margin:0 0 18px">${esc(para).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n  ");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.7;font-size:15px">
  ${paragraphs}
  <p style="margin:28px 0 0;color:#6b7280;font-size:13px">
    Provided in care with ${esc(brandedAs)}${
      postalAddress ? `<br>${esc(postalAddress)}` : ""
    }
  </p>
  <p style="margin:16px 0 0;color:#6b7280;font-size:13px">
    ${
      unsubscribeUrl
        ? `If you would rather not hear from us like this, you can
    <a href="${esc(unsubscribeUrl)}" style="color:#6b7280">stop these notes</a>.`
        : "If you would rather not hear from us like this, reply to this note and we will stop."
    }
  </p>
</div>`.trim();

  await send({
    to,
    subject,
    text,
    html,
    rethrow: true,
    senderName: brandedAs,
    replyTo,
    // The signed token only stops these notes, but it is still not something
    // to leave lying in a log for anyone to use on the family's behalf.
    logText: unsubscribeUrl
      ? text.replace(unsubscribeUrl, unsubscribeUrl.replace(/token=[^&\s]+/, "token=REDACTED"))
      : text,
    headers: oneClickUnsubscribeUrl
      ? {
          "List-Unsubscribe": `<${oneClickUnsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined,
  });
}

/**
 * Tell a home that somebody used their public page.
 *
 * This exists because the alternative is worse than having no form at all. A
 * bereaved family who fills one in believes they have reached someone; if it
 * only lands in a queue nobody has thought to open, the product has taken a
 * person at the worst moment of their life and given them false comfort.
 *
 * So: it sends, it says plainly which of the two kinds it is, and it carries
 * enough of the request that a director can act from their phone without
 * signing in. What it does not carry is the note -- a stranger's free text
 * pushed into an inbox is where an email template gets used against the
 * person reading it, and everything here goes through `esc` regardless.
 */
export async function sendIntakeNotificationEmail(options: {
  to: string;
  homeName: string;
  kind: "at_need" | "pre_need";
  requesterName: string;
  requesterPhone: string | null;
  requesterEmail: string | null;
  subjectName: string;
  consoleUrl: string;
}): Promise<void> {
  const {
    to,
    homeName,
    kind,
    requesterName,
    requesterPhone,
    requesterEmail,
    subjectName,
    consoleUrl,
  } = options;

  const headline =
    kind === "at_need"
      ? `${requesterName} has asked you to open a file for ${subjectName}.`
      : `${requesterName} has asked to plan their funeral with you in advance.`;

  const reach = [
    requesterPhone ? `Phone: ${requesterPhone}` : "",
    requesterEmail ? `Email: ${requesterEmail}` : "",
  ].filter(Boolean);

  const urgency =
    kind === "at_need"
      ? [
          "They have had a death. Ring them before you do anything else in",
          "this software -- the form is not a substitute for your phone.",
        ].join(" ")
      : "There is no hurry. Nobody has died.";

  const text = [
    headline,
    "",
    urgency,
    "",
    ...reach,
    "",
    "Accept or decline it here:",
    consoleUrl,
    "",
    `— Holding Today, for ${homeName}`,
  ]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 12px;font-size:17px"><strong>${esc(headline)}</strong></p>
  <p style="margin:0 0 20px;${
    kind === "at_need" ? "color:#9a3412" : "color:#6b7280"
  }">${esc(urgency)}</p>
  ${
    reach.length > 0
      ? `<p style="margin:0 0 24px">${reach.map(esc).join("<br>")}</p>`
      : ""
  }
  <p style="margin:0 0 28px">
    <a href="${esc(consoleUrl)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Open the request</a>
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">
    — Holding Today, for ${esc(homeName)}
  </p>
</div>`.trim();

  await send({
    to,
    subject:
      kind === "at_need"
        ? `New request: ${subjectName}`
        : `Pre-need enquiry: ${requesterName}`,
    text,
    html,
  });
}

/**
 * Confirm the address a funeral home registered with.
 *
 * Not redacted in the log, unlike a password reset: this token proves control
 * of an inbox and nothing else. It cannot sign anyone in, cannot change a
 * password, and grants no access to a single case — so a deployment without
 * SMTP can read the link out of its own log and get on with the pilot, which
 * is exactly the situation this product is in on its first day.
 */
export async function sendEmailVerificationEmail(options: {
  to: string;
  homeName: string;
  verifyUrl: string;
  expiresInDays: number;
}): Promise<void> {
  const { to, homeName, verifyUrl, expiresInDays } = options;

  const text = [
    `Thank you for setting up ${homeName} on Holding Today.`,
    "",
    "Please confirm this is your address:",
    verifyUrl,
    "",
    `The link works once, and lasts ${expiresInDays} days.`,
    "",
    "Everything in your console already works — this confirmation is what",
    "switches on the request form on your public page, so that the page",
    "families reach belongs to a home we have heard from.",
    "",
    "— Holding Today",
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 20px">
    Thank you for setting up <strong>${esc(homeName)}</strong> on Holding&nbsp;Today.
  </p>
  <p style="margin:0 0 28px">
    <a href="${esc(verifyUrl)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Confirm your address</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link works once and lasts ${expiresInDays} days. If the button doesn't
    work, paste this into your browser:<br>
    <span style="word-break:break-all">${esc(verifyUrl)}</span>
  </p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">
    Everything in your console already works. This confirmation is what
    switches on the request form on your public page.
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— Holding Today</p>
</div>`.trim();

  await send({
    to,
    subject: `Confirm your address for ${homeName}`,
    text,
    html,
  });
}

/**
 * Where a home stands with its trial.
 *
 * Three of these go out — a week before, the day before, and on the day it
 * ends — and the copy rules are the product's own: no countdown, no urgency,
 * no exclamation mark, and a plain sentence about what changes and what does
 * not. What does not change is nearly everything, and saying so is the honest
 * part: a director reading this must not think Thursday's funeral is at risk.
 */
export async function sendTrialReminderEmail(options: {
  to: string;
  homeName: string;
  /** Days remaining. Zero means the trial has ended. */
  daysLeft: number;
  billingUrl: string;
}): Promise<void> {
  const { to, homeName, daysLeft, billingUrl } = options;

  const ended = daysLeft <= 0;

  const opening = ended
    ? `The trial for ${homeName} has come to an end.`
    : daysLeft === 1
      ? `The trial for ${homeName} ends tomorrow.`
      : `The trial for ${homeName} ends in ${daysLeft} days.`;

  const consequence = ended
    ? [
        "Opening a new case now asks for a subscription first. Everything else",
        "carries on exactly as it was: every case already open stays open, the",
        "families working on them keep their links, the aftercare check-ins",
        "already agreed to still go out, and you can export any case at any",
        "time — including if you decide not to continue.",
      ]
    : [
        "When it does, the only thing that changes is opening a new case.",
        "Cases already open stay open, families keep their links, aftercare",
        "check-ins still go out, and you can export any case at any time —",
        "including if you decide not to continue.",
      ];

  const text = [
    opening,
    "",
    ...consequence,
    "",
    ended ? "To carry on:" : "To set up a subscription before then:",
    billingUrl,
    "",
    "If you would rather talk it through first, reply to this message.",
    "",
    "— Holding Today",
  ].join("\n");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.6;font-size:15px">
  <p style="margin:0 0 20px">${esc(opening)}</p>
  <p style="margin:0 0 24px;color:#4b5563">${esc(consequence.join(" "))}</p>
  <p style="margin:0 0 28px">
    <a href="${esc(billingUrl)}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">${ended ? "Carry on" : "Set up a subscription"}</a>
  </p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:13px">
    If you would rather talk it through first, reply to this message.
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— Holding Today</p>
</div>`.trim();

  await send({
    to,
    subject: ended
      ? `${homeName}: your trial has ended`
      : daysLeft === 1
        ? `${homeName}: your trial ends tomorrow`
        : `${homeName}: your trial ends in ${daysLeft} days`,
    text,
    html,
  });
}
