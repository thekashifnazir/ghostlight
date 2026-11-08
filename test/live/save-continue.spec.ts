import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// save-progress Requirement 6.3: reach a second room, reload the page, continue
// from the save, and land in the SAME room.
//
// This needs the real wasm engine (so a save file is actually written) and a
// real browser IndexedDB (so the IDBFS mount persists across the reload), so it
// lives in the live Playwright project alongside live.spec.ts and SKIPS with a
// clear message when there is no local build (R6.3, matching the web-build
// split that keeps the replay suite green without a build).
//
// It drives by keyboard only and reads the live region (the screen reader's
// text surface), never canvas pixels.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

// Room 62 is the tavern (start); its short is unique to it.
const ROOM_62_SHORT = "stone tavern with a wooden floor";

test.describe("save-progress: continue after reload", () => {
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  test("reaches a second room, reloads, continues, lands in the same room", async ({
    page,
  }) => {
    const live = page.locator("#live-region");

    // 1. Boot fresh into the tavern (room 62).
    await page.goto("/index.html?live");
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 90_000 });

    // 2. Leave the tavern for a second room. Rather than assume the exit's
    // position in the hotspot list, cycle focus with ArrowRight and interact
    // (Enter) on each hotspot until the room changes — the tavern's unique
    // short stops showing and stays gone. Crossing into the next room triggers
    // the room-change autosave (save-progress R2.5), which writes the autosave
    // slot and commits it to IndexedDB. Record the room we land in.
    let changed = false;
    for (let i = 0; i < 12 && !changed; i++) {
      await page.keyboard.press("Enter");
      // Give any walk / door transition a moment to settle.
      await page.waitForTimeout(800);
      const text = (await live.textContent())?.trim() ?? "";
      if (text.length > 0 && !text.includes(ROOM_62_SHORT)) {
        changed = true;
        break;
      }
      await page.keyboard.press("ArrowRight");
    }
    expect(changed, "expected to leave the tavern into a second room").toBe(true);
    await expect(live).not.toContainText(ROOM_62_SHORT, { timeout: 90_000 });
    const secondRoomText = (await live.textContent())?.trim() ?? "";
    expect(secondRoomText.length).toBeGreaterThan(0);

    // Give the autosave's A11Y_SAVED + IndexedDB commit a moment to settle.
    await page.waitForTimeout(1500);

    // 3. Reload the page. The in-memory MEMFS is wiped; only IndexedDB survives.
    await page.goto("/index.html?live");

    // 4. On reload the onboarding offers Continue (a save exists). Choose it.
    const resume = page.locator("#resume-choice");
    const continueButton = page.locator("#continue-button");
    await expect(resume).toBeVisible({ timeout: 30_000 });
    await expect(continueButton).toBeFocused();
    await continueButton.click();

    // Continue records the load intent and reloads into --save-slot; the
    // continue boot announces "Loaded: <room>" and reads the second room.
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
    await expect(live).toContainText("Loaded", { timeout: 90_000 });

    // 5. Land in the SAME room: not the tavern, and the same room name as before
    // the reload. Read the whole room (L) to get the room announcement again,
    // then compare its room name against the pre-reload second room.
    await expect(live).not.toContainText(ROOM_62_SHORT);
    await page.keyboard.press("l"); // read room
    const afterReloadText = (await live.textContent())?.trim() ?? "";
    // The room name is the first sentence of the announcement; compare the
    // leading name token so transient differences (inventory, hero) do not fail
    // a genuine same-room match.
    const nameOf = (t: string) => t.split(/[.,]/)[0].trim().toLowerCase();
    expect(nameOf(afterReloadText)).toBe(nameOf(secondRoomText));
  });
});
