import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Web-build Requirement 6: boot the REAL ScummVM wasm build and assert it
// reaches room 62 (the tavern) — the spike's proven entry point.
//
// This check is deliberately separate from the replay-based player tests
// (a different Playwright project/config), so the player suite still runs green
// on a machine with no wasm build (R6.5).
//
// It drives the page by keyboard only and reads the live region (the screen
// reader's text surface) — never canvas pixels (R6.4). When the engine reaches
// room 62, the player renders the room-62 announcement from the pack into the
// live region; room 62 ("Inn bar") has a short description unique to it ("a
// stone tavern with a wooden floor"), so that text unambiguously proves the
// engine reached the tavern. A11Y room-state console lines (when the backend
// forwards them) are captured as a secondary signal.
//
// When the wasm build or game data is absent locally, the file SKIPS with a
// clear message naming scripts/build-web.sh and scripts/fetch.sh (R6.3, R6.5).

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

// Room 62's pack short (unique to room 62; room 14 shares the name "Inn bar"
// but a different short), so matching it confirms the tavern specifically.
const ROOM_62_SHORT = "stone tavern with a wooden floor";

test.describe("live wasm build", () => {
  // Skip the whole file when there is no local build, with a clear message.
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  test("boots the real engine and reaches room 62", async ({ page }) => {
    // Secondary signal: capture any A11Y room-state console line the backend
    // forwards (the engine's own room 62 state), for extra confidence.
    const roomNumbers: number[] = [];
    page.on("console", (msg) => {
      const m = msg.text().match(/A11Y\s+(\{.*"room"\s*:\s*\d+.*\})/);
      if (!m) return;
      try {
        const state = JSON.parse(m[1]) as { room?: number };
        if (typeof state.room === "number") roomNumbers.push(state.room);
      } catch {
        /* not a room-state JSON line */
      }
    });

    // Load the page in live mode. ?live selects the LiveAdapter (task 7 wiring).
    await page.goto("/index.html?live");

    // The start gate is shown and keyboard-operable. Pass it by keyboard, which
    // also unlocks audio and boots the engine (no canvas interaction).
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");

    // The gate hides once start() resolves (the first room has been read).
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });

    // Primary assertion: the live region carries room 62's announcement. The
    // room-62 short is unique to the tavern, so this proves the real engine
    // booted, picked the Drascula target, and entered room 62 — read end to end
    // through the player's own event routing, as a screen reader would hear it.
    await expect(page.locator("#live-region")).toContainText(ROOM_62_SHORT, {
      timeout: 90_000,
    });

    // Secondary: if the backend forwarded A11Y room lines to the console, the
    // only room entered so far is 62 (the intro is skipped by the engine patch).
    if (roomNumbers.length > 0) {
      expect(roomNumbers).toContain(62);
    }
  });
});
