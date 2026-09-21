import { expect, test } from "@playwright/test";
import { CONSOLE } from "../playwright.config";
import { buildWorld, openFamilyLink, signIn } from "./world";

/**
 * The tick, end to end, through two browsers.
 *
 * The server-side suite already proves an unticked memory never reaches the
 * brief. This proves the thing a family actually relies on: that the control
 * they pressed on a phone is the control that governs what a stranger reads
 * out at a funeral. Those are different claims, and only one of them is
 * about the checkbox.
 *
 * The failure mode is not a bug report. It is a minister reading a private
 * family argument from a pulpit.
 */
test.describe("what the family agreed to", () => {
  test("keeps an unticked memory off the officiant's sheet", async ({
    browser,
    request,
  }) => {
    const world = await buildWorld(request);

    const phone = await browser.newContext();
    const page = await phone.newPage();
    await openFamilyLink(page, world);

    await page.getByRole("link", { name: /things to remember/i }).click();

    // One to be read out.
    await page.getByRole("button", { name: "What did they always say?" }).click();
    await page
      .getByPlaceholder(/a few sentences is plenty/i)
      .fill("She fed every cat on the street and denied it.");
    await page.getByRole("button", { name: /keep it/i }).click();
    await expect(page.getByText(/fed every cat/)).toBeVisible();

    // One that is the family's own business. The tick comes off before it
    // is kept, which is the path a family takes when they mean it.
    await page.getByRole("button", { name: /something else/i }).click();
    await page
      .getByPlaceholder(/a few sentences is plenty/i)
      .fill("The argument with Auntie Pat in 1998 that nobody has mentioned since.");
    await page
      .getByRole("checkbox")
      .or(page.locator('input[type="checkbox"]'))
      .first()
      .uncheck();
    await page.getByRole("button", { name: /keep it/i }).click();
    await expect(page.getByText(/Auntie Pat/)).toBeVisible();
    await expect(page.getByRole("button", { name: /just for us/i })).toBeVisible();

    await phone.close();

    // Now the sheet the minister is handed.
    const desk = await browser.newContext();
    const director = await desk.newPage();
    await signIn(director, world);
    await director.goto(`${CONSOLE}/api/cases/${world.caseId}/officiant-brief`);

    const sheet = await director.content();
    expect(sheet).toContain("fed every cat");
    expect(sheet, "an unticked memory must never reach the minister").not.toContain(
      "Auntie Pat",
    );

    await desk.close();
  });

  test("lets a family take one back after they have written it", async ({
    browser,
    request,
  }) => {
    const world = await buildWorld(request);

    const phone = await browser.newContext();
    const page = await phone.newPage();
    await openFamilyLink(page, world);

    await page.getByRole("link", { name: /things to remember/i }).click();
    await page.getByRole("button", { name: "What did they always say?" }).click();
    await page
      .getByPlaceholder(/a few sentences is plenty/i)
      .fill("Something said at three in the morning.");
    await page.getByRole("button", { name: /keep it/i }).click();

    // Second thoughts, which is the whole reason the control stays on the card.
    await page.getByRole("button", { name: /for the service/i }).click();
    await expect(page.getByRole("button", { name: /just for us/i })).toBeVisible();
    await phone.close();

    const desk = await browser.newContext();
    const director = await desk.newPage();
    await signIn(director, world);
    await director.goto(`${CONSOLE}/api/cases/${world.caseId}/officiant-brief`);

    expect(await director.content()).not.toContain("three in the morning");
    await desk.close();
  });
});
