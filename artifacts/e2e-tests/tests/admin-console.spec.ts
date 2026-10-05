import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { adminConsoleBase, PLATFORM_ADMIN_EMAIL } from "../ports";
import { ensurePlatformAdminAccount, PLATFORM_ADMIN_PASSWORD } from "../platform-admin";

/**
 * The platform console, which until this file no browser had ever opened.
 *
 * Signing in needs the one account on the platform-admin list, which
 * platform-admin.ts registers and confirms (it says how, and why that is the
 * only shortcut taken).
 */

test("a platform admin signs in, adds a home, and opens it", async ({ page }) => {
  await ensurePlatformAdminAccount();

  await page.goto(adminConsoleBase);
  await page.getByLabel("Email address").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(PLATFORM_ADMIN_PASSWORD);
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

  // The new home is findable, and opens. The search-results table is scoped
  // because the Financials section below it links every home by the same
  // name -- the same destination, so no a11y fault, but two identical
  // accessible names on the page.
  await page.getByLabel("Find a home").fill(name);
  await page
    .getByRole("table")
    .first()
    .getByRole("link", { name, exact: true })
    .click();
  await expect(page).toHaveURL(/\/homes\/\d+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Creating it was written to the access log, which is the console's
  // promise to an insurer: every look across the tenant line leaves a line.
  await page.getByRole("link", { name: "This home in the access log" }).click();
  await expect(page).toHaveURL(/\/audit\?homeId=\d+$/);
  await expect(page.getByText(name).first()).toBeVisible();
});
