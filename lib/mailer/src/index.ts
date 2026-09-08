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
};

function readConfig(): MailerConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  const port = Number(SMTP_PORT ?? 587);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer, got "${SMTP_PORT}"`);
  }

  return {
    host: SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: SMTP_FROM ?? SMTP_USER,
  };
}

let cached: { transport: Transporter; from: string } | null | undefined;

function getTransport(): { transport: Transporter; from: string } | null {
  if (cached !== undefined) return cached;

  const config = readConfig();

  if (!config) {
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
      auth: { user: config.user, pass: config.pass },
    }),
    from: config.from,
  };

  return cached;
}

/** True when real email can actually go out. Exposed for the health check. */
export function isMailConfigured(): boolean {
  return getTransport() !== null;
}

/** Raised only by `send({ rethrow: true })`. */
export class MailNotSentError extends Error {
  readonly name = "MailNotSentError";
}

async function send(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
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
}): Promise<void> {
  const mailer = getTransport();

  if (!mailer) {
    logger.warn(
      { to: message.to, subject: message.subject, body: message.text },
      "SMTP not configured — email not sent, logged instead",
    );
    if (message.rethrow) {
      throw new MailNotSentError("SMTP is not configured on this deployment.");
    }
    return;
  }

  try {
    const { rethrow, ...payload } = message;
    void rethrow;
    await mailer.transport.sendMail({ from: mailer.from, ...payload });
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
    <a href="${resetUrl}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Choose a new password</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link works once, and expires in ${expiresInMinutes} minutes.
    If the button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${resetUrl}</span>
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
    ${invitedBy} has added you to <strong>${homeName}</strong> on Holding&nbsp;Today.
  </p>
  <p style="margin:0 0 28px">
    <a href="${inviteLink}"
       style="display:inline-block;background:#1f4e46;color:#ffffff;
              text-decoration:none;padding:12px 26px;border-radius:999px;
              font-weight:600">Choose a password</a>
  </p>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">
    The link works once and expires in ${expiresInMinutes} minutes. If the
    button doesn't work, paste this into your browser:<br>
    <span style="word-break:break-all">${inviteLink}</span>
  </p>
  <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">— Holding Today</p>
</div>`.trim();

  await send({ to, subject: `You've been added to ${homeName}`, text, html });
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
}): Promise<void> {
  const { to, subject, body, brandedAs } = options;

  const text = `${body}\n\n— Provided in care with ${brandedAs}`;

  const paragraphs = body
    .split("\n\n")
    .map(
      (para) =>
        `<p style="margin:0 0 18px">${para.replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n  ");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:520px;margin:0 auto;padding:32px 24px;color:#1f2937;
            line-height:1.7;font-size:15px">
  ${paragraphs}
  <p style="margin:28px 0 0;color:#6b7280;font-size:13px">
    Provided in care with ${brandedAs}
  </p>
</div>`.trim();

  await send({ to, subject, text, html, rethrow: true });
}
