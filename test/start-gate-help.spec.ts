import { expect, test, type Page } from "@playwright/test";

// Start-gate bug (uninformed playtest): pressing F1 on the start gate STARTED
// the game instead of reading the controls. The gate's "any key begins"
// shortcut must ignore F1 and instead read the help text (the same HELP_TEXT as
// in-game F1) without starting, leaving the gate visible. These checks run on
// the replay path (?replay=<fixture>) like the other player specs — the gate is
// page behaviour and needs no wasm build.

const LIVE = "#live-region";
const GATE = "#start-gate";

function live(page: Page) {
  return page.locator(LIVE);
}

test.describe("F1 on the start gate (uninformed-playtest fix)", () => {
  test("F1 reads the controls and does NOT start; the gate stays visible", async ({
    page,
  }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();

    // Press F1 on the gate.
    await page.keyboard.press("F1");

    // The gate is still visible — F1 did not start the game.
    await expect(page.locator(GATE)).toBeVisible();

    // The live region now carries the controls help (same text as in-game F1).
    // Its distinctive opening clause is enough to identify it.
    await expect(live(page)).toContainText(
      "Left and Right cycle the things, people and exits in the room.",
    );
    await expect(live(page)).toContainText("F1 or question mark reads this help.");

    // The game surface has NOT been activated: #game is still a plain div,
    // never promoted to role="application" (which only happens on start).
    const role = await page.evaluate(
      () => document.getElementById("game")?.getAttribute("role") ?? null,
    );
    expect(role).toBeNull();
  });

  test("F1 can be pressed repeatedly, then any other key still starts", async ({
    page,
  }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();

    // F1 twice: the gate stays up both times (the handler is not a one-shot).
    await page.keyboard.press("F1");
    await expect(page.locator(GATE)).toBeVisible();
    await page.keyboard.press("F1");
    await expect(page.locator(GATE)).toBeVisible();

    // A non-F1 key now starts the game: the gate hides and the room is read.
    await page.keyboard.press("Enter");
    await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
    await expect(live(page)).toContainText("Here:");
  });
});
