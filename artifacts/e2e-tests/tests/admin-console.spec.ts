import { test, expect, request as playwrightRequest } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { adminConsoleBase, apiBase, PLATFORM_ADMIN_EMAIL } from "../ports";

/**
 * The platform console, which until this file no browser had ever opened.
 *
 * The api-server is started with PLATFORM_ADMIN_EMAILS naming one address
 * (see playwright.config.ts), and the row is also granted below. Being on
 * that list is not an account, though --
 * a platform admin is an ordinary staff sign-in that is also on the list --
 * so the account is registered here, once. A second run against the same
 * database finds it already there, which is fine: the password is the same.
 *
 * The console also refuses an address nobody has confirmed, and the
 * confirmation link only exists in an email. So the one shortcut in this file
 * marks it confirmed in the database directly, the same way global-setup.ts
 * talks to it, rather than weakening that check for tests.
 */
const PASSWORD = "correct-horse-battery-staple-1";

async function ensurePlatformAdminAccount() {
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  await api.post("/api/auth/register", {
    data: {
      homeName: "Continuum (e2e)",
      ownerName: "Platform Admin",
      email: PLATFORM_ADMIN_EMAIL,
      password: PASSWORD,
    },
  });
  await api.dispose();

  execFileSync(
    "psql",
    [
      process.env.E2E_DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/funeral_home_e2e",
      "-q",
      "-c",
      `UPDATE users SET email_verified = true WHERE email = '${PLATFORM_ADMIN_EMAIL}'`,
      // PLATFORM_ADMIN_EMAILS is only read at boot, into an existing table,
      // and on a fresh database the api-server can boot before global-setup
      // has pushed the schema. So the row is granted here as well; the
      // bootstrap has its own tests in api-server.
      "-c",
      `INSERT INTO platform_admins (email, added_by_email) VALUES ('${PLATFORM_ADMIN_EMAIL}', 'e2e') ON CONFLICT (email) DO NOTHING`,
    ],
    { stdio: "inherit" },
  );
}

test("a platform admin signs in, adds a home, and opens it", async ({ page }) => {
  await ensurePlatformAdminAccount();

  await page.goto(adminConsoleBase);
  await page.getByLabel("Email address").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.getByRole("link", { name: "Homes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Homes" })).toBeVisible();

  const name = `Juniper Hill ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Add a home" }).first().click();
  await page.getByLabel("Name of the home").fill(name);
  await page
    .getByLabel("Owner's email address")
    .fill(`owner-${randomUUID()}@e2e.test`);
  await page.getByRole("button", { name: "Create the home" }).click();

  await expect(page.getByRole("heading", { name: `${name} is ready` })).toBeVisible();

  // The owner's invitation goes to the owner's inbox and nowhere else. The
  // link *is* their account -- whoever opens it first chooses the password --
  // so the console must never be handed one. There is no mail server in
  // this suite, and the page says so honestly rather than claiming it sent.
  await expect(page.getByText("no invitation was sent")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("reset-password");
  await expect(page.locator("body")).not.toContainText("token=");

  // The new home is findable, and opens.
  await page.getByLabel("Find a home").fill(name);
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/\/homes\/\d+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Creating it was written to the access log, which is the console's
  // promise to an insurer: every look across the tenant line leaves a line.
  await page.getByRole("link", { name: "This home in the access log" }).click();
  await expect(page).toHaveURL(/\/audit\?homeId=\d+$/);
  await expect(page.getByText(name).first()).toBeVisible();
});
