import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// save-progress Requirement 6.3: save in a room, reload the page, continue from
// the save, and land back in the SAME room.
//
// This needs the real wasm engine (so a save file is actually written and
// A11Y_SAVED is emitted) and a real browser IndexedDB (so the IDBFS mount
// persists across the reload), so it lives in the live Playwright project
// alongside live.spec.ts and SKIPS with a clear message when there is no local
// build (R6.3, matching the web-build split that keeps the replay suite green
// without a build).
//
// It drives by keyboard only and reads the live region (the screen reader's
// text surface), never canvas pixels.
//
// Why save in the tavern rather than first walking to another room: the tavern
// (room 62) is where the player starts, and its only exit crosses a chapter
// boundary through NPC conversations and a cutscene — a heavy, non-deterministic
// path to drive from a test. The room-change autosave is already covered by the
// save-manager unit tests; what only a live run can prove is that a save is
// committed to IndexedDB and that the Continue boot reloads with --save-slot and
// lands in the saved room. Saving with C in the tavern exercises exactly that
// round-trip deterministically. The saved room (62) is the "same room" the
// Continue must return to.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

// Room 62 is the tavern (start); its short is unique to it, so matching it
// confirms the tavern specifically (room 14 shares the name "Inn bar").
const ROOM_62_SHORT = "stone tavern with a wooden floor";

test.describe("save-progress: continue after reload", () => {
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  test("saves, reloads, continues, and lands back in the saved room", async ({
    page,
  }) => {
    const live = page.locator("#live-region");

    // 1. Boot fresh into the tavern (room 62).
    await page.goto("/index.html?live");
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 90_000 });

    // 2. Save with the C key. The engine writes slot 1 and emits
    // A11Y_SAVED {"slot":1,...}; the page parses it, commits MEMFS -> IndexedDB,
    // and announces "Saved." Wait for that confirmation so the IndexedDB commit
    // has happened before the reload.
    await page.keyboard.press("c");
    await expect(live).toContainText("Saved.", { timeout: 15_000 });

    // 3. Reload the page. In-memory MEMFS is wiped; only IndexedDB survives, so
    // the save is gone from memory but present in the store.
    await page.goto("/index.html?live");

    // 4. On reload the onboarding offers Continue, because the pre-boot probe
    // found the save in IndexedDB. The choice is focusable and focused.
    const resume = page.locator("#resume-choice");
    const continueButton = page.locator("#continue-button");
    await expect(resume).toBeVisible({ timeout: 30_000 });
    await expect(continueButton).toBeFocused();
    await continueButton.click();

    // Continue records the load intent and reloads into --save-slot; the
    // continue boot announces "Loaded: <room>" once the saved room is read.
    await expect(live).toContainText("Loaded", { timeout: 90_000 });

    // 5. Land back in the SAME room we saved in — the tavern. Read the whole
    // room (L) and confirm the tavern's unique short, proving the Continue boot
    // loaded the save and resumed in room 62.
    await page.keyboard.press("l");
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 30_000 });
  });
});
