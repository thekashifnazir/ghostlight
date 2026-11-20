import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Live regression for the chapter-2 blocker: using the inn-bar exit "stairs
// down to the street" (room 14, exit 159 -> room 12) left the web player wedged.
//
// The bug, seen against the live wasm build: focus the "stairs down to the
// street" exit and press Enter (sends `walk 159`). The engine changes to room
// 12, but the a11y layer emitted only `A11Y_PHASE busy` and the `walk 159` echo,
// then nothing — no `A11Y_PHASE control`, no new room state. So
// window.__ghostlight.phase stayed "busy" for 60s+, the hotspot list still
// showed the inn bar, and the exit said nothing.
//
// The engine fix (engine/a11y.cpp poll() tail): on a command-driven within-
// chapter room change, re-emit the new room's A11Y state line (refreshing the
// hotspot list and speaking the room name on arrival) and re-stamp the poll
// liveness clock so `A11Y_PHASE control` is emitted on the settling frame. The
// engine-truth status tracker (src/engine/status.ts) then returns to 'ready'.
//
// This spec drives the page by KEYBOARD ONLY and reads the live region (the
// screen reader's text surface) and window.__ghostlight — never canvas pixels
// (web-build R6.4). It reaches chapter 2 room 14 through the real chapter 1 -> 2
// crossing (the same route sweep.spec.ts proves), then uses the street exit and
// asserts the player returns to 'ready', the live region speaks the street room
// name, and window.__ghostlight.room is 12 (the hotspot list reflects room 12).
//
// Like the other live specs it SKIPS with a clear message when there is no local
// wasm build, so the replay suite and a build-less machine stay green (R6.5).

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

// Room 62's pack short, unique to the tavern, so matching it confirms the boot
// reached the tavern specifically (room 14 shares the name "Inn bar").
const ROOM_62_SHORT = "stone tavern with a wooden floor";

// The street room's pack name and a phrase from its short/long. Room 12 is
// "Street outside the inn"; its description names a "crooked village street at
// night". Either confirms the exit landed in, and SPOKE, the street room.
const STREET_NAME = "Street outside the inn";
const STREET_PHRASE = "crooked village street";

const LIVE = "#live-region";

type GlPhase =
  | "gate"
  | "booting"
  | "ready"
  | "busy"
  | "conversation"
  | "choice"
  | "cutscene"
  | "loading"
  | "error";

declare global {
  interface Window {
    __ghostlight?: {
      phase: GlPhase;
      room: number;
      chapter: number;
      lineSeq: number;
      lastLine: string;
      lines: { seq: number; t: number; text: string }[];
    };
  }
}

/** Wait until the engine has settled after the last command (phase 'ready'). */
async function waitReady(page: Page, timeout = 90_000): Promise<void> {
  await page.waitForFunction(
    () => window.__ghostlight?.phase === "ready",
    undefined,
    { timeout },
  );
}

/** Read the current live-region text (the screen reader's surface). */
async function liveText(page: Page): Promise<string> {
  return (await page.locator(LIVE).textContent()) ?? "";
}

/** Boot the live engine by keyboard and wait until the tavern is read. */
async function bootToTavern(page: Page): Promise<void> {
  await page.goto("/index.html?live");
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss gate, unlock audio, boot engine
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator(LIVE)).toContainText(ROOM_62_SHORT, {
    timeout: 90_000,
  });
  await waitReady(page);
}

test.describe("live chapter-2 inn-bar -> street exit (Chrome)", () => {
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  // The route plays the full bartender conversation and the chapter crossing
  // (the bedtime scene plays out, about 3 min 30 s) before the exit under
  // test, so give it a long budget.
  test.setTimeout(600_000);

  test("using the street exit returns to ready, speaks the street room, and shows room 12", async ({
    page,
  }) => {
    const live = page.locator(LIVE);

    // Fail loudly if the engine's FS send path ever throws (the regression the
    // live boot spec also guards).
    let sawSendError = false;
    page.on("console", (msg) => {
      if (/has no (booted Module|MEMFS)/.test(msg.text())) sawSendError = true;
    });
    page.on("pageerror", (err) => {
      if (/has no (booted Module|MEMFS)/.test(err.message)) sawSendError = true;
    });

    await bootToTavern(page);

    // --- Reach chapter 2 room 14 through the real crossing -------------------
    // 1. Talk to the bartender (sets engine flag 0, opening the curtained
    //    doorway). Step the list focus to the bartender NPC and Enter.
    let onBartender = false;
    for (let i = 0; i < 12 && !onBartender; i++) {
      await page.keyboard.press("ArrowRight");
      if ((await liveText(page)).toLowerCase().includes("bartender")) {
        onBartender = true;
      }
    }
    expect(onBartender, "never reached the bartender in the room list").toBe(true);
    await page.keyboard.press("Enter"); // talk 52 — opens the conversation

    // Let the conversation play out fully; the engine reports 'ready' the moment
    // it ends and can take a command again.
    await page.waitForFunction(
      () => window.__ghostlight?.phase === "ready",
      undefined,
      { timeout: 240_000 },
    );

    // Confirm the room was handed over: the ch1.bed hint ("… curtained doorway
    // …") becomes available once flag 0 is set, so a single H names it.
    let handedOver = false;
    for (let i = 0; i < 6 && !handedOver; i++) {
      await page.keyboard.press("h");
      await waitReady(page, 30_000);
      // The hint is recorded (not read over the ghost's voice), so check the
      // readiness signal's last line, which both paths update.
      if ((await page.evaluate(() => window.__ghostlight?.lastLine ?? "")).toLowerCase().includes("curtained doorway")) {
        handedOver = true;
      }
    }
    expect(handedOver, "bartender never handed over the room").toBe(true);

    // 2. Walk through the curtained doorway (exit 105). The bedtime cutscene
    //    plays to its end and the engine settles chapter 2 on its own.
    let onDoorway = false;
    for (let i = 0; i < 14 && !onDoorway; i++) {
      await page.keyboard.press("ArrowRight");
      if (
        (await liveText(page))
          .toLowerCase()
          .startsWith("curtained doorway to the guest rooms")
      ) {
        onDoorway = true;
      }
    }
    expect(onDoorway, "never reached the curtained doorway").toBe(true);
    await page.keyboard.press("Enter"); // walk 105 -> crossing

    // The crossing lands in chapter 2 with the announcement, and settles.
    await expect(live).toContainText("Chapter 2:", { timeout: 300_000 });
    await waitReady(page, 120_000);
    // We are now in chapter 2 room 14 (the inn bar).
    await page.waitForFunction(
      () => window.__ghostlight?.chapter === 2 && window.__ghostlight?.room === 14,
      undefined,
      { timeout: 30_000 },
    );

    // --- THE EXIT UNDER TEST: inn bar -> street -----------------------------
    // 3. Focus the "stairs down to the street" exit (pack label for exit 159)
    //    and press Enter to send `walk 159`.
    let onStairs = false;
    for (let i = 0; i < 16 && !onStairs; i++) {
      await page.keyboard.press("ArrowRight");
      if (
        (await liveText(page)).toLowerCase().includes("stairs down to the street")
      ) {
        onStairs = true;
      }
    }
    expect(onStairs, "never reached the 'stairs down to the street' exit").toBe(
      true,
    );
    await page.keyboard.press("Enter"); // walk 159 -> room 12 (the bug site)

    // 4a. THE FIX: the player returns to 'ready'. Before the fix the phase stayed
    //     "busy" indefinitely (no A11Y_PHASE control), so this would time out.
    await waitReady(page, 90_000);

    // 4b. The hotspot list reflects room 12 (not the inn bar): window.__ghostlight
    //     tracks the engine room, driven by the re-emitted room-12 state line.
    await page.waitForFunction(
      () => window.__ghostlight?.room === 12,
      undefined,
      { timeout: 30_000 },
    );

    // 4c. The exit SPEAKS the new room on arrival: the live region carries the
    //     street room name / description (before the fix the exit said nothing).
    const spoken = (await liveText(page)).toLowerCase();
    expect(
      spoken.includes(STREET_NAME.toLowerCase()) ||
        spoken.includes(STREET_PHRASE.toLowerCase()),
      `the street room was not spoken on arrival (live region: "${spoken}")`,
    ).toBe(true);

    // The L key re-reads the room; it must name the street too (the hotspot
    // list genuinely moved to room 12, not a stale inn-bar read).
    await page.keyboard.press("l");
    await expect(live).toContainText(STREET_NAME, { timeout: 30_000 });

    expect(sawSendError, "LiveAdapter.send() threw the FS/booted-Module error").toBe(
      false,
    );
  });
});
