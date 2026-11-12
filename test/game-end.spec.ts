import { expect, test } from "@playwright/test";
// The last chapter ends: the ending is announced in the live region in plain
// words, and once the engine stops, focus moves to a control that goes back to
// the start gate. Replay fixture ch6-ending: one command (`use 9 56`) answered
// by A11Y_GAME_END, then the (modelled) engine exit.
test("the ending is announced and focus lands on the way back to the start", async ({
  page,
}) => {
  // The live region holds one line at a time, so record every line it speaks.
  await page.addInitScript(() => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    new MutationObserver(() => {
      const t = document.getElementById("live-region")?.textContent ?? "";
      if (t && w.__said[w.__said.length - 1] !== t) w.__said.push(t);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto("/?replay=ch6-ending");
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss the gate
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
  await page.keyboard.press("/");
  await expect(page.locator("#command-box-input")).toBeFocused();
  await page.locator("#command-box-input").fill("use crucifix on dracula");
  await page.keyboard.press("Enter");
  const live = page.locator("#live-region");
  const said = () =>
    page.evaluate(() => (window as unknown as { __said: string[] }).__said);
  await expect.poll(async () => (await said()).join(" | ")).toContain(
    "The game is finished. The credits are playing.",
  );
  // The ending's own line was announced too (lines in one batch replace each
  // other in the region, so check the transcript, which mirrors every line).
  await expect(page.locator("#transcript")).toContainText("THE END.");
  // The credits are still playing: the engine has not stopped, so focus stays.
  const back = page.locator("#back-to-start");
  await expect(back).not.toBeFocused();
  // Once the engine stops, focus lands on the way back.
  await expect(back).toBeFocused();
  await expect(back).toHaveAccessibleName(/start/i);
  await expect(live).toContainText("go back to the start screen");
  // R still repeats the last line while the button has focus.
  await page.keyboard.press("r");
  await expect(live).toContainText("go back to the start screen");
});
