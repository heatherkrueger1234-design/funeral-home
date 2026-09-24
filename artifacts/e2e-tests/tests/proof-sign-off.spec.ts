import { test, expect, request as playwrightRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { apiBase, familyPortalBase } from "../ports";

/**
 * A proof, answered in a real browser.
 *
 * The proof step exists because the most common reprint is a misspelled
 * name and only the family can catch it. For a long time the family could
 * look at a proof and do nothing else: no approve, no "this is wrong". This
 * pins both halves of the answer against a running API, because the wiring
 * between them — the portal's buttons, the confirmation, the status the
 * director then reads — is exactly what unit tests on either side miss.
 *
 * Setup goes through the API, as in family-messaging.spec.ts.
 */

async function sharedProof() {
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

  const created = await api.post("/api/cases", {
    data: { decedentFirstName: "Margaret", decedentLastName: "Hale" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id: caseId } = await created.json();

  const contact = await api.post(`/api/cases/${caseId}/contacts`, {
    data: { name: "Anne Hale", relationship: "Daughter", role: "next_of_kin" },
  });
  expect(contact.ok(), await contact.text()).toBeTruthy();
  const { link } = await contact.json();

  const item = await api.post(`/api/cases/${caseId}/print`, {
    data: { templateKey: "prayer-card", title: "Prayer card" },
  });
  expect(item.ok(), await item.text()).toBeTruthy();
  const { id: printItemId } = await item.json();

  const share = await api.put(`/api/print/${printItemId}`, {
    data: { status: "proof", sharedWithFamily: true },
  });
  expect(share.ok(), await share.text()).toBeTruthy();

  const token = new URL(link).pathname.split("/f/")[1];
  if (!token) throw new Error(`Could not extract a token from link: ${link}`);

  return {
    token,
    // What the director's print list says about it now.
    async directorStatus() {
      const list = await api.get(`/api/cases/${caseId}/print`);
      const [first] = await list.json();
      return first as {
        status: string;
        approvedByName: string | null;
        changesRequestedNote: string | null;
      };
    },
    dispose: () => api.dispose(),
  };
}

test("the family says something needs changing, and the director gets the note", async ({
  page,
}) => {
  const proof = await sharedProof();

  await page.goto(`${familyPortalBase}/f/${proof.token}`);
  await expect(page.getByRole("heading", { name: "Margaret Hale" })).toBeVisible();

  // The hub says a proof is waiting before anybody goes looking.
  await expect(page.getByText("One is waiting for you to read")).toBeVisible();

  await page.goto(`${familyPortalBase}/proofs`);
  await page.getByRole("button", { name: "Something needs changing" }).click();
  await page
    .getByRole("textbox", { name: "What needs changing" })
    .fill("Her name is spelled Margaret, not Margret.");
  await page.getByRole("button", { name: "Send to the funeral home" }).click();

  await expect(page.getByText("Anne Hale asked for a change")).toBeVisible();
  // Back with the home, so there is nothing left for the family to approve.
  await expect(page.getByRole("button", { name: /approve it/ })).toHaveCount(0);

  const status = await proof.directorStatus();
  expect(status.status).toBe("draft");
  expect(status.changesRequestedNote).toBe(
    "Her name is spelled Margaret, not Margret.",
  );

  await proof.dispose();
});

test("the next of kin approves a proof and the director sees who", async ({
  page,
}) => {
  const proof = await sharedProof();

  await page.goto(`${familyPortalBase}/f/${proof.token}`);
  await expect(page.getByRole("heading", { name: "Margaret Hale" })).toBeVisible();

  await page.goto(`${familyPortalBase}/proofs`);
  await page.getByRole("button", { name: /approve it/ }).click();
  // Two hundred copies ride on this, so it asks once more.
  await page.getByRole("button", { name: "Yes, print it" }).click();

  await expect(page.getByText("Approved by Anne Hale")).toBeVisible();
  await expect(page.getByRole("button", { name: /approve it/ })).toHaveCount(0);

  const status = await proof.directorStatus();
  expect(status.status).toBe("approved");
  expect(status.approvedByName).toBe("Anne Hale");

  await proof.dispose();
});
