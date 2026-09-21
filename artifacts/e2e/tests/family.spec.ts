import { expect, test } from "@playwright/test";
import { PORTAL } from "../playwright.config";
import { buildWorld, openFamilyLink, watchApiFailures } from "./world";

/**
 * The family's side, on a phone, from the text message onwards.
 *
 * This is the journey every server-side test in the repository cannot see:
 * a real browser, a real bundle, a credential that lives in localStorage
 * rather than in a header somebody remembered to set.
 */
test.describe("the family portal", () => {
  test("opens from a texted link without a single failed request", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    const failures = watchApiFailures(page);

    await openFamilyLink(page, world);

    /*
     * The regression this exists for.
     *
     * The credential used to be registered with the API client from an
     * effect inside the provider, and React runs a child's effects before
     * its parent's — so the opening request of every cold load went out with
     * no Authorization header, got a correct 401, and recovered on the
     * retry. It looked like a slow first paint. It was a family one dropped
     * retry away from being told a working link had expired.
     */
    expect(failures, "a cold load should not 401 on its way in").toEqual([]);

    // And the token is off the screen: a phone passed round a kitchen table
    // must not be displaying the credential.
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("still works on the next visit, with the link out of the address bar", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await openFamilyLink(page, world);

    const failures = watchApiFailures(page);
    await page.goto(`${PORTAL}/`);

    await expect(page.getByRole("heading", { name: world.decedent })).toBeVisible();
    expect(failures).toEqual([]);
  });

  test("writes a memory down and marks it for the service", async ({ page, request }) => {
    const world = await buildWorld(request);
    await openFamilyLink(page, world);
    const failures = watchApiFailures(page);

    await page.getByRole("link", { name: /things to remember/i }).click();
    await expect(page.getByRole("heading", { name: /things to remember/i })).toBeVisible();

    await page.getByRole("button", { name: "What did they always say?" }).click();
    await page
      .getByPlaceholder(/a few sentences is plenty/i)
      .fill("Put the kettle on and we will think about it.");
    await page.getByRole("button", { name: /keep it/i }).click();

    await expect(page.getByText("Put the kettle on and we will think about it.")).toBeVisible();
    // Ticked by default: a family that has to opt in to being heard mostly
    // forgets to, and the minister gets an empty sheet.
    await expect(page.getByRole("button", { name: /for the service/i })).toBeVisible();

    // The question it answered drops off the list of ones still to answer.
    await expect(
      page.getByRole("button", { name: "What did they always say?" }),
    ).toHaveCount(0);

    expect(failures).toEqual([]);
  });

  test("takes a song from the suggestions and puts it in the right list", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await openFamilyLink(page, world);
    const failures = watchApiFailures(page);

    await page.getByRole("link", { name: /hymns and readings/i }).click();

    // Scoped to the suggestions panel throughout: once a song is on the list
    // its own row carries a "Remove I'll Fly Away" button, so an unscoped
    // search by name finds two different controls that do opposite things.
    const suggestions = page
      .locator("section")
      .filter({ hasText: /if you're stuck on music/i });

    await suggestions.getByRole("button", { name: /country and gospel/i }).click();
    await suggestions.getByRole("button", { name: /I'll Fly Away/i }).click();

    // A hymn lands under Hymns, not under Music — the row says so before it
    // is pressed, and this is the assertion behind that promise.
    const hymns = page.locator("section").filter({ hasText: /^Hymns/ });
    await expect(hymns.getByText("I'll Fly Away")).toBeVisible();

    // And offering it again would be a bug.
    await expect(
      suggestions.getByRole("button", { name: /I'll Fly Away/i }),
    ).toBeDisabled();

    expect(failures).toEqual([]);
  });

  test("answers the obituary a field at a time, saving as it goes", async ({
    page,
    request,
  }) => {
    const world = await buildWorld(request);
    await openFamilyLink(page, world);
    const failures = watchApiFailures(page);

    await page.getByRole("link", { name: /the obituary/i }).click();

    await page.getByLabel("Born", { exact: true }).fill("4 March 1938");
    await page.getByLabel("Their full name").click();

    await expect(page.getByRole("status")).toContainText(/saved/i);

    // It survives a reload, which is the only proof that "saves as you go"
    // means anything to somebody who closed the tab.
    await page.reload();
    await expect(page.getByLabel("Born", { exact: true })).toHaveValue("4 March 1938");

    expect(failures).toEqual([]);
  });

  test("tells a visitor with no link what to do, rather than failing", async ({ page }) => {
    const failures = watchApiFailures(page);

    await page.goto(`${PORTAL}/`);

    await expect(
      page.getByRole("heading", { name: /this page needs your link/i }),
    ).toBeVisible();
    // No request is fired at all without a credential to fire it with.
    expect(failures).toEqual([]);
  });

  test("says the link has expired only when it actually has", async ({ page, request }) => {
    const world = await buildWorld(request);

    await page.goto(`${PORTAL}/f/${world.token.slice(0, -4)}xxxx`);
    await expect(
      page.getByRole("heading", { name: /this link has expired/i }),
    ).toBeVisible();
  });
});
