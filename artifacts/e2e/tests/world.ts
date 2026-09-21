import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { CONSOLE, PORTAL } from "../playwright.config";

/**
 * A funeral home, a case and a family link, built through the API.
 *
 * Deliberately not a seeded fixture database. Every spec makes its own
 * tenant, which is what lets the suite run in parallel without tests
 * tripping over each other's cases — and it means the setup path itself is
 * exercised on every run, so a registration that quietly broke would fail
 * the suite rather than fail a demo.
 *
 * It goes through the API rather than the UI because clicking through a
 * sign-up form to reach the screen you actually meant to test is how an
 * end-to-end suite becomes slow and flaky. The UI for registration has its
 * own test.
 */

let sequence = 0;

export type World = {
  homeName: string;
  email: string;
  password: string;
  homeId: number;
  caseId: number;
  contactId: number;
  /** The token out of the texted link: the family's entire credential. */
  token: string;
  decedent: string;
};

export const PASSWORD = "correct-horse-battery";

export async function buildWorld(
  request: APIRequestContext,
  options: { decedentFirstName?: string; decedentLastName?: string; serviceInDays?: number } = {},
): Promise<World> {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}-${Math.floor(Math.random() * 1e6)}`;
  const email = `e2e-${stamp}@example.com`;
  const homeName = `Willowbank ${stamp}`;

  const registered = await request.post(`${CONSOLE}/api/auth/register`, {
    data: {
      homeName,
      email,
      password: PASSWORD,
      displayName: "Karen Voss",
    },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const { home } = await registered.json();

  const first = options.decedentFirstName ?? "Margaret";
  const last = options.decedentLastName ?? "Hale";
  const days = options.serviceInDays ?? 5;

  const created = await request.post(`${CONSOLE}/api/cases`, {
    data: {
      decedentFirstName: first,
      decedentLastName: last,
      decedentPreferredName: "Peggy",
      serviceAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      serviceLocation: "St Mary's Chapel",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const row = await created.json();

  const invited = await request.post(`${CONSOLE}/api/cases/${row.id}/contacts`, {
    data: { name: "Anne Hale", relationship: "Daughter", role: "next_of_kin" },
  });
  expect(invited.status(), await invited.text()).toBe(201);
  const contact = await invited.json();

  const token = String(contact.link).split("/f/")[1];
  expect(token, "the invite should carry a usable link").toBeTruthy();

  return {
    homeName,
    email,
    password: PASSWORD,
    homeId: home.id,
    caseId: row.id,
    contactId: contact.id,
    token: token!,
    decedent: `Peggy ${last}`,
  };
}

/**
 * Arrive the way a family does: open the texted link, once.
 *
 * The wait is on the person's name rather than on a network idle, because
 * the thing worth asserting is that the portal opened — and because this is
 * the exact path that used to spend its first request being refused.
 */
export async function openFamilyLink(page: Page, world: World): Promise<void> {
  await page.goto(`${PORTAL}/f/${world.token}`);
  await expect(page.getByRole("heading", { name: world.decedent })).toBeVisible();
}

/** Sign a director in through the form, because that is how they do it. */
export async function signIn(page: Page, world: World): Promise<void> {
  await page.goto(`${CONSOLE}/`);
  await page.getByLabel(/email/i).fill(world.email);
  await page.getByLabel(/password/i).fill(world.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("link", { name: /^Cases$/ })).toBeVisible();
}

/**
 * Every request the page made that came back 4xx or 5xx.
 *
 * Attached to a page and asserted empty at the end of a journey. A portal
 * that renders correctly while quietly 401ing on its way there is a portal
 * one dropped retry away from telling a family their link has expired, and
 * that is exactly the failure this suite exists to catch.
 */
export function watchApiFailures(page: Page): string[] {
  const failures: string[] = [];

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/") && response.status() >= 400) {
      failures.push(`${response.status()} ${response.request().method()} ${new URL(url).pathname}`);
    }
  });

  page.on("pageerror", (error) => failures.push(`uncaught: ${error.message}`));

  return failures;
}
