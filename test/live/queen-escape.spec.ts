// Queen room 70 escape in the browser: take both sheets, tie one to the other
// from the inventory (item on item), and hear the sheet rope added.
import { expect, test } from "@playwright/test";

test("?game=queen: the two sheets tie into a rope from the inventory", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/index.html?live&game=queen");
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter");
  const transcript = page.locator("#transcript");
  for (let i = 0; i < 24; i++) {
    if (((await transcript.textContent()) ?? "").includes("heavy metal door")) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(5000);
  }
  const say = async (phrase: string) => {
    await page.keyboard.press("/");
    await page.waitForTimeout(400);
    await page.keyboard.type(phrase);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(8000);
  };
  await say("take left sheets");
  await say("take right sheets");
  // Inventory (bat, then the two sheets): pick one sheet, then the other.
  const key = async (k: string, ms = 700) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };
  await key("Tab");
  await key("ArrowDown");
  await key("Enter");
  // Stay in the inventory (Tab there now goes back to the room with the item
  // kept). With an item active the menu also offers Yourself; walk to the
  // other sheet by name.
  for (let i = 0; i < 6; i++) {
    const heard = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return (a?.getAttribute("aria-label") || a?.textContent || "").trim(); });
    if (/item 52|sheet/i.test(heard) && !/active/i.test(heard)) break;
    await key("ArrowDown");
  }
  await key("Enter", 8000);
  const text = (await transcript.textContent()) ?? "";
  // The sheet rope is item 53; once the pack names it, the line says so.
  expect(text).toMatch(/Received (item 53|[^.]*rope)/i);
});
