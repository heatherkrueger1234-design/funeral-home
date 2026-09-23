/**
 * The SMTP settings that used to fail without a sound.
 *
 * Each of these once meant password resets quietly never arrived: the mailer
 * fell back to writing mail to the log, or sent from an address that was not
 * one. `send-test-email` exists to surface them at setup time, and these
 * pin down that it does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SMTP_VARS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PASSWORD",
  "SMTP_FROM",
];
const ORIGINAL = Object.fromEntries(
  SMTP_VARS.map((name) => [name, process.env[name]]),
);

async function mailerWith(env: Record<string, string>) {
  for (const name of SMTP_VARS) delete process.env[name];
  Object.assign(process.env, env);
  vi.resetModules();
  return import("@workspace/mailer");
}

afterEach(() => {
  for (const name of SMTP_VARS) {
    if (ORIGINAL[name] === undefined) delete process.env[name];
    else process.env[name] = ORIGINAL[name];
  }
  vi.resetModules();
});

describe("SMTP settings that cannot work", () => {
  it("names the missing variable when only some are set", async () => {
    // A typo in one name is enough: SMTP_PASSWORD instead of SMTP_PASS.
    const mailer = await mailerWith({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "care@example.com",
      SMTP_PASSWORD: "right-pass",
    });
    await expect(mailer.sendTestEmail("me@example.com")).rejects.toThrow(
      /half configured: SMTP_PASS is not set/,
    );
    expect(mailer.isMailConfigured()).toBe(false);
  });

  it("refuses to send from an API key when SMTP_FROM is missing", async () => {
    // Postmark, SendGrid and Resend all sign in with a key, not an address.
    const mailer = await mailerWith({
      SMTP_HOST: "smtp.sendgrid.net",
      SMTP_USER: "apikey",
      SMTP_PASS: "SG.not-a-real-key",
    });
    await expect(mailer.sendTestEmail("me@example.com")).rejects.toThrow(
      /SMTP_FROM is not set/,
    );
    expect(mailer.isMailConfigured()).toBe(false);
  });

  it("treats an empty SMTP_PORT as the default, which is what compose passes", async () => {
    const mailer = await mailerWith({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "",
      SMTP_USER: "care@example.com",
      SMTP_PASS: "right-pass",
    });
    expect(mailer.isMailConfigured()).toBe(true);
  });

  it("says plainly when nothing is configured at all", async () => {
    const mailer = await mailerWith({});
    await expect(mailer.sendTestEmail("me@example.com")).rejects.toThrow(
      /SMTP is not configured/,
    );
  });
});
