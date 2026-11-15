import { expect, test, type Page } from "@playwright/test";

// The "How to play" guide on the start screen (tester feedback, 14 Nov). On the
// replay path the guide is never offered first, so these check the "How to
// play" button after Start: Enter on it opens the guide instead of starting the
// game, the pages step with Next (one button per page), focus lands on each page heading, and
// the last page's button starts the game.

async function gameStarted(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.getElementById("game")?.getAttribute("role") === "application",
  );
}

test.describe("How to play guide", () => {
  test("opens from the start screen, steps through 5 pages, then starts", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator("#start-button")).toBeFocused();
    await expect(page.locator("#guide-button")).toHaveText("How to play");

    await page.keyboard.press("Tab");
    await expect(page.locator("#guide-button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#guide-title")).toHaveText("Moving around, page 1 of 5");
    await expect(page.locator("#guide-title")).toBeFocused();
    expect(await gameStarted(page)).toBe(false);

    const titles = ["Using things", "Talking", "Getting help", "Saving and more"];
    for (const [i, t] of titles.entries()) {
      await page.locator("#guide-next").click();
      await expect(page.locator("#guide-title")).toHaveText(`${t}, page ${i + 2} of 5`);
      await expect(page.locator("#guide-title")).toBeFocused();
    }
    await expect(page.locator("#guide-next")).toHaveCount(0);
    // One button per page: no Back or Skip to choose between.
    await expect(page.locator("#guide-nav button")).toHaveCount(1);

    // Letters typed while reading the guide never start the game.
    await page.keyboard.press("h");
    expect(await gameStarted(page)).toBe(false);

    await page.locator("#guide-finish").click();
    await expect(page.locator("#start-gate")).toBeHidden();
    expect(await gameStarted(page)).toBe(true);
  });

  test("Enter on a page heading moves on, without a Tab to the button", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator("#start-button")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#guide-button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#guide-title")).toBeFocused();

    const titles = ["Using things", "Talking", "Getting help", "Saving and more"];
    for (const [i, t] of titles.entries()) {
      await page.keyboard.press(i % 2 === 0 ? "Enter" : " ");
      await expect(page.locator("#guide-title")).toHaveText(`${t}, page ${i + 2} of 5`);
      await expect(page.locator("#guide-title")).toBeFocused();
    }
    expect(await gameStarted(page)).toBe(false);

    // A screen reader in browse mode clicks the heading instead of sending Enter.
    await page.locator("#guide-title").click();
    await expect(page.locator("#start-gate")).toBeHidden();
    expect(await gameStarted(page)).toBe(true);
  });

  test("Enter on Start still starts the game straight away", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator("#start-button")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden();
    expect(await gameStarted(page)).toBe(true);
  });
});
