import { test, expect, request as playwrightRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { apiBase, familyPortalBase } from "../ports";

/**
 * The product's whole pitch, end to end, in a real browser: a director opens
 * a case and texts a link; a family member opens that link on their own
 * phone, with no account, and the message they send lands.
 *
 * Setup (registering the home, opening the case, inviting the contact) goes
 * straight through the API — that flow already has thorough coverage in
 * artifacts/api-server/test/case-lifecycle.test.ts. What has never been
 * exercised anywhere else in this repo is the part after that: a real
 * browser rendering the family portal against a real, running api-server.
 */

async function createFamilyLink() {
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  const suffix = randomUUID();

  const register = await api.post("/api/auth/register", {
    data: {
      homeName: `E2E Home ${suffix}`,
      ownerName: "E2E Director",
      email: `director-${suffix}@e2e.test`,
      password: "correct-horse-battery-staple-1",
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();

  const createCase = await api.post("/api/cases", {
    data: { decedentFirstName: "Eleanor", decedentLastName: "Vance" },
  });
  expect(createCase.ok(), await createCase.text()).toBeTruthy();
  const { id: caseId } = await createCase.json();

  const contact = await api.post(`/api/cases/${caseId}/contacts`, {
    data: {
      name: "Morgan Vance",
      relationship: "Daughter",
      email: `morgan-${suffix}@e2e.test`,
      phone: "+15555550123",
    },
  });
  expect(contact.ok(), await contact.text()).toBeTruthy();
  const { link } = await contact.json();

  await api.dispose();

  const token = new URL(link).pathname.split("/f/")[1];
  if (!token) throw new Error(`Could not extract a token from link: ${link}`);
  return token;
}

test("a family member opens their link and sends a message", async ({
  page,
}) => {
  const token = await createFamilyLink();

  // The link as it actually arrives by text: /f/<token>, on a device with no
  // prior visit and nothing in localStorage.
  await page.goto(`${familyPortalBase}/f/${token}`);

  // Confirms both that the token was accepted and that the case renders —
  // this is the Hub page, keyed off the family session the token unlocks.
  await expect(
    page.getByRole("heading", { name: "Eleanor Vance" }),
  ).toBeVisible();

  // The URL is rewritten so the credential stops being on screen (see
  // src/lib/link.tsx) — worth pinning, since regressing it means a
  // screenshot of the portal becomes a working link to someone's case.
  await expect(page).toHaveURL(`${familyPortalBase}/`);

  await page.goto(`${familyPortalBase}/messages`);

  const body = "Thank you for everything. When can we drop off photographs?";
  await page.getByPlaceholder("What would you like to ask?").fill(body);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(body)).toBeVisible();

  // Reload to prove the message round-tripped through the real API and
  // database rather than only existing in the mutation's optimistic state.
  await page.reload();
  await expect(page.getByText(body)).toBeVisible();
});

test("a made-up link is refused, not shown someone else's case", async ({
  page,
}) => {
  await page.goto(`${familyPortalBase}/f/not-a-real-token-at-all`);

  await expect(
    page.getByRole("heading", { name: "This link has expired" }),
  ).toBeVisible();
});
