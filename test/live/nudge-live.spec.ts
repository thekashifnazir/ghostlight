// Live check: the worth-a-look nudge comes straight after
// the room name, after the S sweep summary, and H then starts at the clue.
import { expect, test, type Page } from "@playwright/test";

const LIVE = "#live-region";
async function waitReady(page: Page, timeout = 90_000) {
  await page.waitForFunction(() => (window as any).__ghostlight?.phase === "ready", undefined, { timeout });
}
const lines = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as any).__ghostlight?.lines ?? []).map((l: any) => l.text as string));
const lastLine = (page: Page) => page.evaluate(() => (window as any).__ghostlight?.lastLine ?? "");

test("nudge placement and H starting at the clue", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/index.html?live");
  await page.keyboard.press("Enter");
  await expect(page.locator(LIVE)).toContainText("stone tavern with a wooden floor", { timeout: 90_000 });
  await waitReady(page);
  const first = (await lines(page)).find((t) => t.includes("stone tavern")) ?? "";
  console.log("ENTRY:", first);
  expect(first.startsWith("Inn bar. Worth a look: It's late, and you'll need somewhere to sleep.")).toBe(true);

  await page.keyboard.press("s");
  await page.waitForTimeout(500);
  const sweep = (await lines(page)).at(-1) ?? "";
  console.log("SWEEP:", sweep);
  expect(sweep).toMatch(/^\d+ things, left to right: .*\. Worth a look: It's late, and you'll need somewhere to sleep\.$/);

  await page.keyboard.press("h");
  await waitReady(page, 30_000);
  await page.waitForTimeout(500);
  const hint = await lastLine(page);
  console.log("H1:", hint);
  expect(hint).toContain("The bartender runs the place");

  await page.keyboard.press("h");
  await waitReady(page, 30_000);
  await page.waitForTimeout(500);
  const hint2 = await lastLine(page);
  console.log("H2:", hint2);
  expect(hint2).toContain("Talk to the bartender");
});
