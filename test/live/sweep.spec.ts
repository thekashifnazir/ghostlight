import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Live end-to-end sweep against the REAL ScummVM wasm build, run on BOTH Chrome
// and WebKit (the two projects in playwright.live.config.ts). It is the broadest
// live check: it exercises every key a tester can press in the game ("the tester
// DM" key map — the keys listed in F1 help and bound in src/ui/controller.ts),
// drives the full chapter 1 -> chapter 2 crossing, and round-trips a save with
// the C (save) and O (load) keys.
//
// It is the regression guard for the two live bugs a sweep surfaced:
//   1. The typed command box: with the box open, every letter must type into
//      the input, and only Enter/Escape act on the box — no key may fire a game
//      action (the old bug sent L/O/K… to the controller while typing).
//   2. The chapter 1 -> 2 crossing: walking through the curtained doorway runs
//      the bedtime cutscene (animation_2_1, "THERE IS NO PLACE LIKE HOME"),
//      which blocks the engine until a single `skip` is written WHILE it runs.
//      The web player now pages that skip automatically on a scripted-exit walk,
//      so the player reaches chapter 2 with an announcement — this test proves
//      it against the live engine (keyboard only, never canvas pixels).
//
// Like the other live specs, it SKIPS with a clear message when there is no
// local wasm build, so the replay suite and a build-less machine stay green
// (web-build R6.5). Claude Code runs it against the real build and deploys.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");

const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const SKIP_MESSAGE =
  `live build not found under ${buildOut}. ` +
  `Run scripts/fetch.sh then scripts/build-web.sh to produce scummvm.wasm and ` +
  `the /data game tree, then re-run this check.`;

// Room 62's pack short, unique to the tavern (room 14 shares the name "Inn
// bar" but a different short), so matching it confirms the tavern specifically.
const ROOM_62_SHORT = "stone tavern with a wooden floor";

const LIVE = "#live-region";
const BOX = "#command-box";
const INPUT = "#command-box-input";

/** Boot the live engine by keyboard and wait until the tavern is read. */
async function bootToTavern(page: Page): Promise<void> {
  await page.goto("/index.html?live");
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss gate, unlock audio, boot engine
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 90_000 });
  await expect(page.locator(LIVE)).toContainText(ROOM_62_SHORT, {
    timeout: 90_000,
  });
}

/** Read the current live-region text (the screen reader's surface). */
async function liveText(page: Page): Promise<string> {
  return (await page.locator(LIVE).textContent()) ?? "";
}

test.describe("live sweep (Chrome + WebKit)", () => {
  // Skip the whole file when there is no local build, with a clear message.
  test.skip(!existsSync(WASM) || !existsSync(PACKET), SKIP_MESSAGE);

  // The crossing drives a slow conversation and a cutscene, so give the sweep a
  // generous budget beyond the config's own timeout.
  test.setTimeout(240_000);

  test("every tester key is safe in the DM and does not break the engine", async ({
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

    // The full tester DM key map (src/ui/controller.ts + F1 HELP_TEXT), each
    // pressed against the live engine. None may throw, reload the page, or leave
    // the live region empty; the game must stay in the tavern throughout (these
    // are all reads/navigation/sound toggles, none of which leaves room 62).
    const keys = [
      "ArrowRight", // next hotspot
      "ArrowLeft", // previous hotspot
      "ArrowDown", // examine (look)
      "ArrowUp", // interact (walk/act) — on a non-exit this acts in place
      "l", // read the whole room
      "r", // repeat the last line
      "Shift+R", // step back through earlier lines
      "h", // ask the ghost for a hint
      "g", // toggle the ghost voice
      "s", // sonar scan
      "n", // sonar next
      "p", // sonar previous
      "m", // toggle sonar sound
      "F1", // read help
      "Backspace", // re-read focus (nothing to cancel in list mode)
    ];
    for (const key of keys) {
      await page.keyboard.press(key);
      // Each key yields a line; the region is never blank and the page never
      // navigated away (a stray reload would drop #live-region).
      await expect(live).toBeVisible();
      await expect(live).not.toHaveText(/^\s*$/);
    }

    // F1 proves the full control list is reachable, including every swept key.
    await page.keyboard.press("F1");
    await expect(live).toContainText("Controls.");

    // The verb menu (V) opens and Escape cancels back to the list.
    await page.keyboard.press("v");
    await expect(live).toContainText("Actions for");
    await page.keyboard.press("Escape");

    // The inventory (Tab) opens and Escape closes it.
    await page.keyboard.press("Tab");
    await expect(live).toContainText(/Inventory/i);
    await page.keyboard.press("Escape");

    // Still in the tavern after the whole sweep — none of these keys leaves it.
    await page.keyboard.press("l");
    await expect(live).toContainText(ROOM_62_SHORT);

    expect(sawSendError, "LiveAdapter.send() threw the FS/booted-Module error").toBe(
      false,
    );
  });

  test("typed command box: letters type in, only Enter/Escape act, no game key fires", async ({
    page,
  }) => {
    const live = page.locator(LIVE);
    await bootToTavern(page);

    // Open the box and type a phrase whose letters include the dangerous game
    // keys O (load), L (read room), K, A, T — character by character, so each
    // keydown really fires. None may trigger a game action; all must type.
    await page.keyboard.press("/");
    await expect(page.locator(BOX)).toBeVisible();
    const input = page.locator(INPUT);
    await expect(input).toBeFocused();

    await input.pressSequentially("look at bartender", { delay: 15 });
    await expect(input).toHaveValue("look at bartender");
    // No stray O reloaded the page, no stray L re-read the room over the input:
    // the box is still open and focused.
    await expect(page.locator(BOX)).toBeVisible();
    await expect(input).toBeFocused();

    // Enter sends it: "look at bartender" -> look 52, and the live engine
    // answers with the bartender's look line. The box closes after sending.
    await page.keyboard.press("Enter");
    await expect(live).toContainText(/bartender/i, { timeout: 30_000 });
    await expect(page.locator(BOX)).toBeHidden();
  });

  test("reaches chapter 2 through the curtained doorway with an announcement", async ({
    page,
  }) => {
    // The bartender conversation plays in full (no skipping), then the crossing
    // runs the bedtime cutscene, so this one test needs a long budget: up to
    // ~4 min waiting on the conversation plus 120 s on the crossing.
    test.setTimeout(480_000);

    const live = page.locator(LIVE);
    await bootToTavern(page);

    // 1. Talk to the bartender to get a room (sets engine flag 0, which opens
    //    the curtained doorway). The bartender is an NPC; the room readout lists
    //    "… bartender …" — step to it and Enter sends `talk 52`.
    let onBartender = false;
    for (let i = 0; i < 12 && !onBartender; i++) {
      await page.keyboard.press("ArrowRight");
      if ((await liveText(page)).toLowerCase().includes("bartender")) {
        onBartender = true;
      }
    }
    expect(onBartender).toBe(true);
    await page.keyboard.press("Enter"); // talk 52 — opens the conversation

    // Let the conversation play out completely WITHOUT pressing any keys that
    // advance it. Escaping here skips the conversation before the bartender
    // hands over the room, which leaves flag 0 unset so the doorway answers
    // "I DON'T HAVE A ROOM YET". Instead, poll with H (hint) every ~10 s: once
    // the bartender has finished and handed over the room, ch1.room is reached
    // and the ch1.bed hint ("… curtained doorway …") becomes available. Press H
    // to escalate the tier until the live region names the curtained doorway.
    // Cap the wait at ~4 min so a wedged engine fails rather than hanging.
    let handedOver = false;
    for (let i = 0; i < 24 && !handedOver; i++) {
      await page.keyboard.press("h"); // ask the ghost for a hint (safe; no skip)
      if ((await liveText(page)).toLowerCase().includes("curtained doorway")) {
        handedOver = true;
        break;
      }
      await page.waitForTimeout(10_000);
    }
    expect(
      handedOver,
      "bartender never handed over the room (no ch1.bed curtained-doorway hint within ~4 min)",
    ).toBe(true);

    // 2. Walk through the curtained doorway (exit 105). Step to it and Enter
    //    sends `walk 105`. The player's own crossing logic then pages the single
    //    `skip` that advances the bedtime cutscene; no manual skip is needed.
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
    expect(onDoorway).toBe(true);
    await page.keyboard.press("Enter"); // walk 105 -> crossing; player pages skip

    // 3. The crossing lands in chapter 2 with the announcement. The pack names
    //    chapter 2 "The village", so the new room reading is prefixed
    //    "Chapter 2: The village." — the proof the player advanced a chapter,
    //    not merely a room. Generous timeout: the cutscene runs for a while.
    await expect(live).toContainText("Chapter 2: The village.", {
      timeout: 120_000,
    });
  });

  test("impatient player: five quick Escapes during the conversation never wedge the engine", async ({
    page,
  }, testInfo) => {
    const live = page.locator(LIVE);
    await bootToTavern(page);

    // Talk to the bartender, then an impatient player mashes Escape to skip the
    // slow conversation. Over-skipping can race the engine, so this guards that
    // the engine is still responsive afterwards: L must read the room back
    // within 30 s. Whether the bartender actually handed over the room (and so
    // whether a full playthrough is still possible from here) is recorded as an
    // annotation, not asserted — the point of THIS test is that the engine is
    // not wedged, not that the room was granted.
    let onBartender = false;
    for (let i = 0; i < 12 && !onBartender; i++) {
      await page.keyboard.press("ArrowRight");
      if ((await liveText(page)).toLowerCase().includes("bartender")) {
        onBartender = true;
      }
    }
    expect(onBartender).toBe(true);
    await page.keyboard.press("Enter"); // talk 52 — opens the conversation

    // Five quick Escapes, back to back.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
    }

    // The engine must still answer a plain read: L reads the room within 30 s.
    await page.keyboard.press("l");
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 30_000 });

    // Record whether the room was handed over despite the impatient skipping,
    // as an annotation rather than an assertion.
    const roomHandedOver = (await liveText(page))
      .toLowerCase()
      .includes("curtained doorway");
    testInfo.annotations.push({
      type: "room-handed-over",
      description: String(roomHandedOver),
    });
  });

  test("C saves and O loads the most recent save (round-trip)", async ({
    page,
  }) => {
    const live = page.locator(LIVE);
    await bootToTavern(page);

    // Save with C: the engine writes slot 1 and emits A11Y_SAVED {"slot":1,…};
    // the page parses it, commits MEMFS -> IndexedDB, and announces "Saved."
    await page.keyboard.press("c");
    await expect(live).toContainText("Saved.", { timeout: 15_000 });
    await expect(live).not.toContainText("can't be saved");

    // Load with O: the load key records a continue-from-slot intent and reloads
    // into --save-slot (the engine loads only at launch), so the boot resumes
    // the saved game and announces "Loaded: <room>".
    await page.keyboard.press("o");
    await expect(live).toContainText("Loaded", { timeout: 90_000 });

    // Read the room (L) and confirm we resumed in the saved tavern (room 62).
    await page.keyboard.press("l");
    await expect(live).toContainText(ROOM_62_SHORT, { timeout: 30_000 });
  });
});
