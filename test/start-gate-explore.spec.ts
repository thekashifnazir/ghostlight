import { expect, test, type Page } from "@playwright/test";

// Start-gate bug (screen-reader-style playtest): pressing Tab on the start gate
// STARTED the game. A screen-reader user presses Tab, Shift+Tab, the arrows and
// screen-reader modifier keys to explore the page before they have decided to
// play, so none of those may start the game — they were being dropped straight
// into play. The gate's "begin" shortcut must start ONLY on Enter, Space or a
// printable letter/number, and ignore Tab, Shift, the arrows, Escape and the
// like. These checks run on the replay path (?replay=<fixture>) like the other
// player specs — the gate is page behaviour and needs no wasm build.

const LIVE = "#live-region";
const GATE = "#start-gate";

function live(page: Page) {
  return page.locator(LIVE);
}

/** True once the game has started: #game is promoted to role=application,
 *  which only happens on start (focusGame → activateGameSurface). */
async function gameStarted(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.getElementById("game")?.getAttribute("role") === "application",
  );
}

test.describe("exploration keys on the start gate must not begin the game", () => {
  // Every key a screen-reader user presses to feel out the page. None of these
  // is an intentional "begin", so each must leave the gate visible and the game
  // unstarted.
  const exploreKeys = [
    "Tab",
    "Shift+Tab",
    "ArrowRight",
    "ArrowLeft",
    "ArrowUp",
    "ArrowDown",
    "Escape",
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "CapsLock",
    "Insert",
  ];

  for (const key of exploreKeys) {
    test(`"${key}" does NOT start the game (the gate stays visible)`, async ({
      page,
    }) => {
      await page.goto("/?replay=tavern");
      await expect(page.locator(GATE)).toBeVisible();

      await page.keyboard.press(key);

      // The gate is still visible and the game was not started.
      await expect(page.locator(GATE)).toBeVisible();
      expect(await gameStarted(page)).toBe(false);
    });
  }

  test("a run of Tab / Shift+Tab / arrows leaves the gate up, then Enter starts", async ({
    page,
  }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();

    // Explore the page the way a screen-reader user would: Tab around and sweep
    // the arrows. None of this starts the game.
    for (const key of ["Tab", "Shift+Tab", "ArrowRight", "ArrowLeft", "ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect(page.locator(GATE)).toBeVisible();
    expect(await gameStarted(page)).toBe(false);

    // Enter is an explicit "begin": the gate hides and the room is read.
    await page.keyboard.press("Enter");
    await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
    await expect(live(page)).toContainText("Here:");
  });

  test("Space also starts the game", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();

    await page.keyboard.press("Space");
    await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
    await expect(live(page)).toContainText("Here:");
  });
});
