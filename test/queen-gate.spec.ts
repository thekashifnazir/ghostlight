// ?game=queen says on the start screen how much of the game is described
// (Kash, 17 Nov: "the title screen [should] advise it only has this many
// rooms"), and the focused gate button carries that as its description, so a
// screen reader that lands straight on the button still hears it.
import { expect, test } from "@playwright/test";

test("the Queen start screen says only the hotel opening is described", async ({ page }) => {
  await page.goto("/?game=queen");
  const intro = page.locator("#gate-intro");
  await expect(intro).toContainText("Flight of the Amazon Queen");
  await expect(intro).toContainText("This is a preview. Only the hotel opening is described: 4 rooms, with hints.");
  await expect(intro).toContainText("no descriptions or hints");
  const first = page.locator("#gate-actions button").first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect(first).toHaveAttribute("aria-describedby", "gate-intro");
  await expect(first).toHaveAccessibleDescription(/This is a preview/);
});

test("the Drascula start screen is unchanged", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#gate-intro")).toHaveText(
    "Ghostlight makes Drascula playable with the keyboard and your screen reader.",
  );
  const first = page.locator("#gate-actions button").first();
  await expect(first).toBeVisible({ timeout: 10_000 });
  await expect(first).not.toHaveAttribute("aria-describedby", /.+/);
});
