import { expect, test, type Page } from "@playwright/test";

// A diff that moves you AND changes what you carry updates the inventory
// (tester report, 18 Nov). In chapter 4, putting on the disguise plays Igor's
// scene: he gives you the living-room keys and the game moves you to room 24,
// all in one diff. The player applied the room change and returned before the
// inventory changes, so the keys only showed after Continue reloaded the save.
// Drives the page through the replay adapter (?replay=ch4-disguise).

async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 20_000 });
}

const spoken = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { __ghostlight?: { lines?: { text: string }[] } }).__ghostlight?.lines ?? []).map(
      (l) => l.text,
    ),
  );

test("the disguise scene adds the living-room keys and takes the disguise", async ({ page }) => {
  await start(page, "ch4-disguise");
  await expect(page.locator("#live-region")).toContainText("Igor");

  await page.keyboard.press("/");
  await page.keyboard.type("use wig on yourself");
  await page.keyboard.press("Enter");

  // The room changed to 24, and the inventory changes were announced with it,
  // in one line (the live region keeps only the newest line).
  await expect
    .poll(async () =>
      (await spoken(page)).some(
        (l) => l.startsWith("Received living-room keys.") && l.includes("You no longer have") && l.includes("the wig"),
      ),
    )
    .toBe(true);

  // The inventory itself has the keys and no longer has the wig.
  await page.keyboard.press("Tab");
  const inv = page.locator("#inventory");
  await expect(inv).toContainText("living-room keys");
  await expect(inv).not.toContainText("wig");
});
