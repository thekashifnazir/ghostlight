import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// save-progress regression: pressing the save key (C) in the real build must
// announce "Saved.", not a failure line. This reproduces the reported bug where
// the engine wrote drascula.001 but the page never matched the A11Y_SAVED line
// (the parser expected a bare slot number, but the engine emits the JSON form
// `A11Y_SAVED {"slot":N,...}`), so the watchdog fired "Progress can't be saved
// right now." A single boot — fast, unlike the continue-after-reload check.
//
// Needs the real wasm engine (so a save file is written and A11Y_SAVED is
// emitted) and a secure/local origin with IndexedDB; skips with a clear message
// when there is no local build.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

const ROOM_62_SHORT = "stone tavern with a wooden floor";

test.describe("save-progress: save key in the real build", () => {
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  test("pressing C in the tavern announces 'Saved.', not a failure", async ({
    page,
  }) => {
    const live = page.locator("#live-region");

    await page.goto("/index.html?live");
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 90_000 });

    // Press the save key. The engine saves slot 1 and emits
    // A11Y_SAVED {"slot":1,...}; the page must parse it, commit, and say
    // "Saved." — within the manager's watchdog window.
    await page.keyboard.press("c");

    await expect(live).toContainText("Saved.", { timeout: 15_000 });
    await expect(live).not.toContainText("can't be saved");
  });
});
