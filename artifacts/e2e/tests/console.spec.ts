import { expect, test } from "@playwright/test";
import { CONSOLE } from "../playwright.config";
import { buildWorld, signIn, watchApiFailures } from "./world";

/**
 * The director's side: sign in, find the case, and get the two documents a
 * service actually needs out of it.
 */
test.describe("the console", () => {
  test("signs a director in and lands them on their own home", async ({ page, request }) => {
    const world = await buildWorld(request);
    const failures = watchApiFailures(page);

    await signIn(page, world);

    await expect(page.getByRole("heading", { name: world.homeName })).toBeVisible();
    expect(failures.filter((f) => !f.includes("/api/auth/me"))).toEqual([]);
  });

  test("shows the service date on the case, where it is read rather than hunted for", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await signIn(page, world);

    await page.goto(`${CONSOLE}/cases/${world.caseId}`);

    await expect(page.getByRole("heading", { name: world.decedent })).toBeVisible();
    // Everything on this page hangs off this one date. Scoped to the header,
    // because there is a "Service" tab a few pixels below it.
    const header = page.locator("header").filter({ hasText: world.decedent });
    await expect(header.getByText("Service", { exact: true })).toBeVisible();
    await expect(header.getByText("St Mary's Chapel")).toBeVisible();
    await expect(page.getByRole("link", { name: /all cases/i })).toBeVisible();
  });

  test("reaches every tab on the case, including the ones past the fold", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await signIn(page, world);
    const failures = watchApiFailures(page);

    await page.goto(`${CONSOLE}/cases/${world.caseId}`);

    /*
     * Twelve tabs on one ruled bar that scrolls. Details and Data sit past
     * the right edge on a laptop, and for a while there was no sign the bar
     * moved at all — so this walks to the end of it on purpose.
     */
    for (const tab of ["Family", "Certificate", "Obituary", "Memories", "Details", "Data"]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toHaveAttribute(
        "data-state",
        "active",
      );
    }

    expect(failures.filter((f) => !f.includes("/api/auth/me"))).toEqual([]);
  });

  test("builds the officiant's sheet out of what the family wrote", async ({
    page,
    request,
    context,
  }) => {
    const world = await buildWorld(request);
    await signIn(page, world);

    // Something for it to carry, added the way a director would when a
    // daughter tells them on the telephone.
    await page.goto(`${CONSOLE}/cases/${world.caseId}`);
    await page.getByRole("tab", { name: /^Memories/ }).click();
    /*
       Two "Keep it" buttons on this panel — one for something a family told
       the director on the telephone, one for what was said at the service —
       so it is found through the field it belongs to rather than by name.
    */
    const told = page.locator("section, div").filter({
      has: page.getByLabel(/something they told you/i),
    });
    await page
      .getByLabel(/something they told you/i)
      .fill("She fed every cat on the street and denied it.");
    await told.last().getByRole("button", { name: /keep it/i }).click();
    await expect(page.getByText(/fed every cat on the street/)).toBeVisible();

    // The sheet opens in its own tab, because the director prints it there.
    const [sheet] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: /open it to print/i }).click(),
    ]);
    await sheet.waitForLoadState();

    await expect(sheet.getByRole("heading", { name: world.decedent })).toBeVisible();
    await expect(sheet.getByText("St Mary's Chapel")).toBeVisible();
    await expect(sheet.getByText(/fed every cat on the street/)).toBeVisible();
    // The blank lines a minister writes on in the vestry.
    await expect(sheet.getByRole("heading", { name: /^Notes$/ })).toBeVisible();
  });

  test("says plainly that a brief was not emailed when email is not set up", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await signIn(page, world);

    await page.goto(`${CONSOLE}/cases/${world.caseId}`);
    await page.getByRole("tab", { name: /^Memories/ }).click();

    await page.getByLabel(/or email it/i).fill("minister@example.com");
    await page.getByRole("button", { name: /send it/i }).click();

    /*
     * The test environment has no SMTP, which is exactly the case that must
     * not come back as "sent". A director who walks into a service believing
     * the minister was sent something has been failed by a green toast.
     */
    // `first()` because a toast renders its text once for the eye and once
    // for a screen reader.
    await expect(page.getByText(/not sent/i).first()).toBeVisible();
    await expect(page.getByText(/no email set up/i).first()).toBeVisible();
  });

  test("takes an erased case out of the list and off the brief", async ({ page, request }) => {
    const world = await buildWorld(request);
    await signIn(page, world);

    /*
       Typed out in full, and it is the *display* name that has to match —
       "Peggy Hale", the name everyone used, not the legal one. That is the
       right choice by the product and it caught this test out, which is
       roughly the point of typing it rather than pressing OK.
    */
    const erased = await request.post(`${CONSOLE}/api/cases/${world.caseId}/delete`, {
      data: { confirmName: world.decedent, reason: "The family asked." },
    });
    expect(erased.status()).toBe(204);

    await page.goto(`${CONSOLE}/cases/${world.caseId}`);
    await expect(page.getByText(/that case isn't here/i)).toBeVisible();
  });
});
