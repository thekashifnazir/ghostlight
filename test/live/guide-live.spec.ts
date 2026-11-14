// Live check: a first visit to the real game is offered the "How to play"
// guide (focused) with a skip; finishing it starts the game, the first room reads
// without the old key list, and the offer is not made again.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("first visit offers the guide; finishing it starts the game and is remembered", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/index.html?live");
  await expect(page.locator("#guide-start")).toBeFocused({ timeout: 30_000 });
  await expect(page.locator("#gate-instruction")).toContainText("New here?");
  await expect(page.locator("#guide-skip-all")).toHaveText("Skip to the game");

  // F1 reads the controls here too, as the gate text promises, without starting.
  await page.keyboard.press("F1");
  await expect(page.locator("#live-region")).toContainText("Controls.");
  await expect(page.locator("#guide-start")).toBeVisible();
  await page.locator("#guide-start").focus();

  // Enter on the focused offer opens page 1, not the game.
  await page.keyboard.press("Enter");
  await expect(page.locator("#guide-title")).toHaveText("Moving around, page 1 of 5");
  await expect(page.locator("#guide-title")).toBeFocused();

  // Each page has only Next; press it through to the end to start the game.
  await expect(page.locator("#guide-nav button")).toHaveCount(1);
  for (let i = 0; i < 4; i++) await page.locator("#guide-next").click();
  await page.locator("#guide-finish").click();
  await expect(page.locator("#start-gate")).toBeHidden();
  await expect(page.locator("#live-region")).toContainText("stone tavern with a wooden floor", { timeout: 90_000 });
  const first = await page.evaluate(
    () => ((window as any).__ghostlight?.lines ?? []).map((l: any) => l.text as string).find((t: string) => t.includes("stone tavern")) ?? "",
  );
  console.log("FIRST ROOM:", first);
  expect(first).toContain("F1 or question mark lists every key.");
  expect(first).not.toContain("Now, how to play");
  expect(await page.evaluate(() => localStorage.getItem("ghostlight.guideSeen"))).toBe("1");

  await page.goto("/index.html?live");
  await expect(page.locator("#start-gate")).toBeVisible();
  await expect(page.locator("#guide-start")).toHaveCount(0);
  await expect(page.locator("#guide-button")).toHaveText("How to play");
});
