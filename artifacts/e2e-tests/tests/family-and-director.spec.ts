import { test, expect, request as playwrightRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { apiBase, directorConsoleBase, familyPortalBase } from "../ports";

/**
 * The two halves talking to each other, each in its own browser.
 *
 * The other specs drive one side at a time. This one is the loop the product
 * is sold on: a family asks a question and brings in a relative from a phone;
 * the director sees the family waiting, answers from the inbox, and the
 * dashboard stops saying anyone is waiting; the family reads the answer. Each
 * of those hand-offs has broken quietly before -- a reply that left the family
 * counted as "waiting", a relative the console could not see -- and none of
 * them can be caught from one side alone.
 */

const PASSWORD = "correct-horse-battery-staple-1";

async function homeWithFamilyLink() {
  const api = await playwrightRequest.newContext({ baseURL: apiBase });
  const suffix = randomUUID();
  const email = `director-${suffix}@e2e.test`;

  const register = await api.post("/api/auth/register", {
    data: {
      homeName: `E2E Home ${suffix}`,
      ownerName: "E2E Director",
      email,
      password: PASSWORD,
    },
  });
  expect(register.ok(), await register.text()).toBeTruthy();

  const created = await api.post("/api/cases", {
    data: { decedentFirstName: "Margaret", decedentLastName: "Whitfield" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id: caseId } = await created.json();

  const contact = await api.post(`/api/cases/${caseId}/contacts`, {
    data: {
      name: "Anne Whitfield",
      relationship: "Daughter",
      // As the console's own form sends it for a next of kin, which is what
      // lets her bring in the rest of the family.
      role: "next_of_kin",
      canInvite: true,
      email: `anne-${suffix}@e2e.test`,
      phone: "+15555550123",
    },
  });
  expect(contact.ok(), await contact.text()).toBeTruthy();
  const { link } = await contact.json();
  await api.dispose();

  const token = new URL(link).pathname.split("/f/")[1];
  if (!token) throw new Error(`Could not extract a token from link: ${link}`);
  return { email, caseId: caseId as number, token };
}

test("a family's question is answered, and nobody is left 'waiting'", async ({
  browser,
}) => {
  const { email, caseId, token } = await homeWithFamilyLink();

  /* ---- The family, on a phone-sized screen. */
  const family = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await family.goto(`${familyPortalBase}/f/${token}`);
  await expect(family.getByRole("heading", { name: "Margaret Whitfield" })).toBeVisible();

  const question = "Could Dad's watch go with her? It was his gift.";
  await family.goto(`${familyPortalBase}/messages`);
  await family.getByPlaceholder("What would you like to ask?").fill(question);
  await family.getByRole("button", { name: "Send" }).click();
  await expect(family.getByText(question)).toBeVisible();

  await family.goto(`${familyPortalBase}/family`);
  await family.getByLabel("Their name").fill("Siobhan Whitfield");
  await family.getByLabel("Their mobile number").fill("5550142233");
  await family.getByRole("button", { name: "Send them a link" }).click();
  await expect(family.getByText("Siobhan Whitfield").first()).toBeVisible();

  /* ---- The director, at a desk. */
  const director = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await director.goto(directorConsoleBase);
  await director.getByLabel("Email").fill(email);
  await director.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await director.getByRole("button", { name: "Sign in" }).click();

  await expect(director.getByText("family is waiting on a reply")).toBeVisible();

  // The relative the family added is on the case, without anyone telling us.
  await director.goto(`${directorConsoleBase}/cases/${caseId}?tab=family`);
  await expect(director.getByText("Siobhan Whitfield").first()).toBeVisible();

  const answer = "Of course. We'll put it on her left wrist, where she wore hers.";
  await director.goto(`${directorConsoleBase}/inbox`);
  // The inbox previews the latest line, which is the thread's own notice
  // that the family brought someone in; the question is beneath it.
  await expect(director.getByText(/Added Siobhan Whitfield/)).toBeVisible();
  await director.getByRole("button", { name: "Reply", exact: true }).click();
  await director.getByLabel("Reply about Margaret Whitfield").fill(answer);
  await director.getByRole("button", { name: "Send", exact: true }).click();

  // Answering is reading: Today no longer counts this family as waiting.
  await director.goto(directorConsoleBase);
  await expect(director.getByRole("link", { name: "Cases" })).toBeVisible();
  await expect(director.getByText("family is waiting on a reply")).toHaveCount(0);

  /* ---- And the family reads the answer. */
  await family.goto(`${familyPortalBase}/messages`);
  await expect(family.getByText(answer)).toBeVisible();
});
