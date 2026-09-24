import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { directorConsoleBase, familyPortalBase } from "../ports";

/**
 * Both ends of one conversation, each in its own browser.
 *
 * The other two specs each drive one side. This one is the loop the product
 * is sold on: a family writes from the link, the director sees them waiting
 * in the inbox, answers from there, and the family reads the answer. It also
 * pins the bug that used to live in the middle of it -- a reply sent from the
 * inbox left the family counted as "unread", at the top of the list, as if
 * nobody had answered them.
 */
test("a family writes, the director answers from the inbox, the family reads it", async ({
  browser,
}) => {
  const suffix = randomUUID();

  // The director's browser. Setup goes through the API with the same cookie
  // jar the pages use, so the session it creates is the one the inbox reads.
  const director = await browser.newContext();
  const api = director.request;
  const register = await api.post(`${directorConsoleBase}/api/auth/register`, {
    data: {
      homeName: `E2E Home ${suffix}`,
      ownerName: "E2E Director",
      email: `director-${suffix}@e2e.test`,
      password: "correct-horse-battery-staple-1",
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();

  const createCase = await api.post(`${directorConsoleBase}/api/cases`, {
    data: { decedentFirstName: "Walter", decedentLastName: "Ashby" },
  });
  expect(createCase.ok(), await createCase.text()).toBeTruthy();
  const { id: caseId } = await createCase.json();

  const contact = await api.post(
    `${directorConsoleBase}/api/cases/${caseId}/contacts`,
    {
      data: {
        name: "June Ashby",
        relationship: "Daughter",
        email: `june-${suffix}@e2e.test`,
        phone: "+15555550124",
      },
    },
  );
  expect(contact.ok(), await contact.text()).toBeTruthy();
  const { link } = await contact.json();
  const token = new URL(link).pathname.split("/f/")[1];

  // The family's browser: a different device, no account.
  const family = await browser.newContext();
  const familyPage = await family.newPage();
  await familyPage.goto(`${familyPortalBase}/f/${token}`);
  await expect(
    familyPage.getByRole("heading", { name: "Walter Ashby" }),
  ).toBeVisible();

  await familyPage.goto(`${familyPortalBase}/messages`);
  const question = "Can we bring his fishing hat to the viewing?";
  await familyPage.getByPlaceholder("What would you like to ask?").fill(question);
  await familyPage.getByRole("button", { name: "Send" }).click();
  await expect(familyPage.getByText(question)).toBeVisible();

  // The director sees them waiting.
  const directorPage = await director.newPage();
  await directorPage.goto(`${directorConsoleBase}/inbox`);
  await expect(directorPage.getByText(question)).toBeVisible();
  await expect(directorPage.getByText("1 unread")).toBeVisible();

  // ...answers without leaving the inbox...
  const answer = "Of course. Bring it Thursday and we'll set it beside him.";
  await directorPage.getByRole("button", { name: "Reply" }).click();
  await directorPage
    .getByRole("textbox", { name: "Reply about Walter Ashby" })
    .fill(answer);
  await directorPage.getByRole("button", { name: "Send", exact: true }).click();

  // ...and they are no longer waiting, including after a fresh load, which
  // is the server's count and not the page's memory of having replied.
  await expect(directorPage.getByText("1 unread")).toHaveCount(0);
  await directorPage.reload();
  await expect(directorPage.getByText(answer)).toBeVisible();
  await expect(directorPage.getByText("1 unread")).toHaveCount(0);

  // The family reads the answer.
  await familyPage.reload();
  await expect(familyPage.getByText(answer)).toBeVisible();

  await family.close();
  await director.close();
});
