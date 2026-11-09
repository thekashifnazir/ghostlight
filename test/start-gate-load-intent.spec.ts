import { expect, test, type Page } from "@playwright/test";

// Regression (c98f0b6): the start gate's "press a key to begin" listener became
// `const gateKeydown`, declared AFTER the gate decision, and startPlaying()
// removed it with doc.removeEventListener("keydown", gateKeydown). On the
// load-intent path (the load key reloads the page with a "continue from slot"
// intent in sessionStorage) the gate decision auto-starts by calling
// startPlaying() BEFORE gateKeydown is initialised, so the removeEventListener
// hit the temporal dead zone and THREW. Boot aborted and loading a save never
// finished (the live "C saves and O loads" sweep timed out).
//
// These checks run on the replay path (?replay=tavern) like the other gate
// specs — the throw was in boot()'s synchronous gate decision, so it reproduces
// without a wasm build. A load intent is injected into sessionStorage before
// any page script runs, so boot() takes the load-intent auto-start branch.

const LIVE = "#live-region";
const GATE = "#start-gate";
const SESSION_KEY = "ghostlight.loadSlot";

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

test.describe("booting on the load-intent path", () => {
  test("auto-starts without throwing and the game begins (no start gate)", async ({
    page,
  }) => {
    // Fail loudly on any uncaught page error — the TDZ ReferenceError the
    // regression threw during boot would surface here.
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // Record a "continue from slot 1" intent before any page script runs, so
    // boot()'s takeLoadIntent() reads it and takes the auto-start branch.
    await page.addInitScript((key) => {
      sessionStorage.setItem(key, "1");
    }, SESSION_KEY);

    await page.goto("/?replay=tavern");

    // The load-intent path auto-starts: no gate is parked in front of the
    // player, the game surface is promoted to role=application, and the first
    // room arrives as the "Loaded: <room>" confirmation (save-progress R2.4),
    // not the fresh-start "Here:" reading.
    await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
    await expect(live(page)).toContainText("Loaded", { timeout: 10_000 });
    expect(await gameStarted(page)).toBe(true);

    // The regression threw a ReferenceError (gateKeydown in the temporal dead
    // zone) during boot; the fix must leave boot error-free.
    expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
  });

  test("a fresh start (no load intent) still parks the gate and begins on Enter", async ({
    page,
  }) => {
    // The sibling path must be unaffected: with no load intent the gate is
    // shown, the document "begin" shortcut is registered, and Enter starts.
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();
    expect(await gameStarted(page)).toBe(false);

    await page.keyboard.press("Enter");
    await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
    await expect(live(page)).toContainText("Here:");
    expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toEqual([]);
  });
});
