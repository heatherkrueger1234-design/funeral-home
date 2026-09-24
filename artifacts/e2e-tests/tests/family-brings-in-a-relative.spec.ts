import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { directorConsoleBase, familyPortalBase } from "../ports";

/**
 * The next of kin brings someone in, and the home finds out without being
 * told.
 *
 * conversation-round-trip.spec.ts covers the message loop. This is the other
 * hand-off between the two sides: the family's "Bring in family" page gives a
 * relative their own link, and the director must see that person on the case
 * and a line in the thread saying so -- otherwise a stranger's name turns up
 * in the photographs and nobody at the home knows who they are.
 */
test("a relative the family adds appears on the director's case and thread", async ({
  browser,
}) => {
  const suffix = randomUUID();

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

  const created = await api.post(`${directorConsoleBase}/api/cases`, {
    data: { decedentFirstName: "Margaret", decedentLastName: "Whitfield" },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id: caseId } = await created.json();

  const contact = await api.post(`${directorConsoleBase}/api/cases/${caseId}/contacts`, {
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
  const token = new URL((await contact.json()).link).pathname.split("/f/")[1];

  /* The family, on a phone. */
  const family = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await family.goto(`${familyPortalBase}/f/${token}`);
  await expect(family.getByRole("heading", { name: "Margaret Whitfield" })).toBeVisible();

  await family.goto(`${familyPortalBase}/family`);
  await family.getByLabel("Their name").fill("Siobhan Whitfield");
  await family.getByLabel("Their mobile number").fill("5550142233");
  await family.getByRole("button", { name: "Send them a link" }).click();
  await expect(family.getByText("Siobhan Whitfield").first()).toBeVisible();

  /* The director. */
  const desk = await director.newPage();
  await desk.goto(`${directorConsoleBase}/cases/${caseId}?tab=family`);
  await expect(desk.getByText("Siobhan Whitfield").first()).toBeVisible();

  await desk.goto(`${directorConsoleBase}/inbox`);
  await expect(desk.getByText(/Added Siobhan Whitfield/)).toBeVisible();
});
