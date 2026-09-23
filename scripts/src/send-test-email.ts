/**
 * Prove the SMTP settings work, before anybody needs them to.
 *
 *   pnpm --filter @workspace/scripts run send-test-email -- you@example.com
 *   docker compose run --rm tools pnpm --filter @workspace/scripts run send-test-email -- you@example.com
 *
 * Connects, signs in and sends one message. Every failure prints the mail
 * server's own reason and exits non-zero, so a wrong password or an
 * unverified sender domain turns up now, rather than on the day a director
 * cannot reset their password.
 */
import { sendTestEmail } from "@workspace/mailer";

async function main(): Promise<void> {
  const to = process.argv.slice(2).find((arg) => arg.includes("@"));

  if (!to) {
    console.error("Usage: send-test-email -- you@example.com");
    process.exitCode = 2;
    return;
  }

  try {
    const { host, port, from } = await sendTestEmail(to);
    console.log(`Sent to ${to} through ${host}:${port}, from ${from}.`);
    console.log(
      "Check it arrived in the inbox, not spam. If it went to spam, the " +
        "sender's domain is missing SPF or DKIM records: DEPLOY.md, " +
        '"Email", has what to add.',
    );
  } catch (err) {
    console.error(
      `Not sent. ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

void main();
