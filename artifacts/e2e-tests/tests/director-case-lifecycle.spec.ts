import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { directorConsoleBase } from "../ports";

/**
 * The director's side of the same story, driven entirely through the UI:
 * open an account, sign in, open a case. No API shortcuts here, unlike
 * family-messaging.spec.ts — this is the one screen (SignIn.tsx) that has
 * never been exercised by anything but a human, since it is also the one
 * screen that sets the session cookie everything else depends on.
 */

test("a director opens an account, signs in, and opens a case", async ({
  page,
}) => {
  const suffix = randomUUID();
  const email = `director-${suffix}@e2e.test`;
  const password = "correct-horse-battery-staple-1";

  await page.goto(directorConsoleBase);

  await page
    .getByRole("button", { name: "Set up a new funeral home" })
    .click();
  await page.getByLabel("Funeral home").fill(`E2E Home ${suffix}`);
  await page.getByLabel("Your name").fill("E2E Director");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Open the account" }).click();

  // Landing on the dashboard, not the sign-in form, is the session cookie
  // having actually been set and read back.
  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();

  await page.getByRole("link", { name: "Cases" }).click();
  await expect(page).toHaveURL(`${directorConsoleBase}/cases`);

  // A fresh account has no open cases, so the empty state's own "Open a
  // case" action renders next to the page header's — same dialog, two
  // legitimate triggers. `.first()` picks either deliberately, rather than
  // failing strict-mode on a duplicate that is by design, not a bug.
  await page.getByRole("button", { name: "Open a case" }).first().click();
  await page.getByLabel("First name").fill("Eleanor");
  await page.getByLabel("Last name").fill("Vance");
  await page.getByRole("button", { name: "Open it" }).click();

  // A new case redirects straight to its own detail page (see Cases.tsx).
  await expect(page).toHaveURL(/\/cases\/\d+$/);
  await expect(
    page.getByRole("heading", { name: "Eleanor Vance" }),
  ).toBeVisible();

  // Signing out and back in again proves the account persisted server-side
  // rather than only existing for the session that created it.
  await page.context().clearCookies();
  await page.goto(directorConsoleBase);
  await expect(page.getByLabel("Email")).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Cases" })).toBeVisible();
});
