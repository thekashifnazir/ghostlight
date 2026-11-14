// ?game=queen boots Flight of the Amazon Queen from the same wasm as Drascula
// and reads the opening room (70, the locked room upstairs) from packs/queen-en.json
// through the player's own announcements, as a screen reader would hear it.
import { expect, test } from "@playwright/test";

const ROOM_70_SHORT = "heavy metal door on the left";

test("?game=queen boots Queen and reads room 70 from the Queen pack", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/index.html?live&game=queen");
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveTitle(/Amazon Queen/, { timeout: 60_000 });
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 180_000 });
  // The floppy intro is long; Escape skips it, as a player would.
  const transcript = page.locator("#transcript");
  for (let i = 0; i < 24; i++) {
    if (((await transcript.textContent()) ?? "").includes(ROOM_70_SHORT)) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(5000);
  }
  await expect(transcript).toContainText(ROOM_70_SHORT, { timeout: 10_000 });
});
