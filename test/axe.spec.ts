import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Runs axe-core across the player's key states and asserts zero violations.
// The canvas and transcript are aria-hidden, so the live region is the surface
// axe checks for the functional content.

async function analyze(page: Page) {
  // @axe-core/playwright bundles its own Playwright types, which can skew from
  // @playwright/test's Page; the runtime object is the same, so cast at this
  // one boundary.
  return new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  // Click the focused Start button (a user gesture) to dismiss the gate and
  // boot the adapter, then wait for the gate to hide.
  await page.locator("#start-button").click();
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
}

test("start screen has no accessibility violations", async ({ page }) => {
  await page.goto("/?replay=tavern");
  await expect(page.locator("#start-gate")).toBeVisible();
  const results = await analyze(page);
  expect(results.violations).toEqual([]);
});

test("in-room play has no accessibility violations", async ({ page }) => {
  await start(page, "tavern");
  await page.keyboard.press("ArrowRight");
  const results = await analyze(page);
  expect(results.violations).toEqual([]);
});

test("verb menu open has no accessibility violations", async ({ page }) => {
  await start(page, "ch2-handbag");
  await page.keyboard.press("ArrowLeft"); // focus the trunk
  await page.keyboard.press("v"); // open the verb menu
  await expect(page.locator("#verb-menu")).toBeVisible();
  const results = await analyze(page);
  expect(results.violations).toEqual([]);
});

test("inventory open has no accessibility violations", async ({ page }) => {
  await start(page, "ch2-vending");
  await page.keyboard.press("Tab"); // open the inventory
  await expect(page.locator("#inventory")).toBeVisible();
  const results = await analyze(page);
  expect(results.violations).toEqual([]);
});
