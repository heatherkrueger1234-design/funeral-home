import { expect, test, type Browser } from "@playwright/test";
import { CONSOLE, PORTAL } from "../playwright.config";
import { buildWorld, openFamilyLink, signIn } from "./world";

/**
 * Getting the certificate details back out again.
 *
 * Every field on this screen was collected from a family so it could be
 * typed into the state's system, and for a while the most important one
 * could not be: the social security number was masked to everybody, which
 * made it write-only and meant a home that needed it had to telephone a
 * bereaved daughter and ask for her mother's SSN a second time.
 *
 * These tests hold both ends of that. The number comes back when a director
 * asks for it. It never appears before they do, and never on the family's
 * side at all.
 */
test.describe("handing the details on", () => {
  const SSN = "123456789";

  /** The family types it in on their phone, which is the only way it gets there. */
  async function familyGivesSsn(
    browser: Browser,
    world: Awaited<ReturnType<typeof buildWorld>>,
  ) {
    const phone = await browser.newContext();
    const page = await phone.newPage();
    await openFamilyLink(page, world);

    await page.goto(`${PORTAL}/certificate`);
    await page.getByPlaceholder("000-00-0000").fill("123-45-6789");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/on file, ending 6789/i)).toBeVisible();

    await phone.close();
  }

  test("shows the number only after a director asks, and says who asked", async ({
    browser,
    request,
  }) => {
    const world = await buildWorld(request);
    await familyGivesSsn(browser, world);

    const desk = await browser.newContext();
    const page = await desk.newPage();
    await signIn(page, world);
    await page.goto(`${CONSOLE}/cases/${world.caseId}`);
    await page.getByRole("tab", { name: /^Certificate/ }).click();

    // Masked until somebody says they need it.
    await expect(page.getByText(/on file, .*6789/i)).toBeVisible();
    expect(await page.content()).not.toContain(SSN);

    await page.getByRole("button", { name: /show it/i }).click();

    await expect(page.getByText(SSN)).toBeVisible();
    await expect(page.getByRole("button", { name: /^copy$/i })).toBeVisible();

    // And it can be put away again by hand, not only by the timer.
    await page.getByRole("button", { name: /^hide$/i }).click();
    await expect(page.getByText(/last shown to Karen Voss/i)).toBeVisible();

    await desk.close();
  });

  test("tells the family their number was looked at, and by whom", async ({
    browser,
    request,
  }) => {
    const world = await buildWorld(request);
    await familyGivesSsn(browser, world);

    const desk = await browser.newContext();
    const director = await desk.newPage();
    await signIn(director, world);
    await director.goto(`${CONSOLE}/cases/${world.caseId}`);
    await director.getByRole("tab", { name: /^Certificate/ }).click();
    await director.getByRole("button", { name: /show it/i }).click();
    await expect(director.getByText(SSN)).toBeVisible();
    await desk.close();

    /*
     * The part that makes the reveal defensible. If we are going to hold
     * somebody's social security number and hand it to staff on request,
     * the person it belongs to gets told — without having to ring up and
     * ask a human.
     */
    const phone = await browser.newContext();
    const page = await phone.newPage();
    await openFamilyLink(page, world);
    await page.goto(`${PORTAL}/certificate`);

    await expect(page.getByText(/shown in full to/i)).toBeVisible();
    await expect(page.getByText(/Karen Voss/)).toBeVisible();
    // Told that it was read, never shown what was read.
    expect(await page.content()).not.toContain(SSN);

    await phone.close();
  });

  test("puts every certificate field one click from the clipboard", async ({
    browser,
    request,
    context,
  }) => {
    const world = await buildWorld(request);

    const desk = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await desk.newPage();
    await signIn(page, world);
    await page.goto(`${CONSOLE}/cases/${world.caseId}`);
    await page.getByRole("tab", { name: /^Certificate/ }).click();

    // Exact, because every field's copy button is labelled "Copy <field>"
    // and a substring match finds both.
    await page.getByLabel("First name", { exact: true }).fill("Margaret");
    await page.getByLabel("Last name", { exact: true }).click();
    await expect(page.getByLabel("First name", { exact: true })).toHaveValue(
      "Margaret",
    );

    await page.getByRole("button", { name: /copy first name/i }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Margaret");

    // And the whole block, for a director who would rather paste once than
    // press thirty little buttons.
    await page.getByRole("button", { name: /copy it all/i }).click();
    const everything = await page.evaluate(() => navigator.clipboard.readText());
    expect(everything).toContain("First name: Margaret");

    void context;
    await desk.close();
  });
});
