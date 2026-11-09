import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// Live regression for a VoiceOver tester's report (9 Nov): they opened the
// drunk's reply menu, listened and browsed the options for about 40 s, then
// pressed Enter on option 3 and heard "The game didn't respond". The engine's
// busy watchdog read the open conversation (no poll(), no output) as a dead
// state and dropped the queued `choose 3`. Every earlier test picked within a
// few seconds, so none of them lingered long enough to see it.
//
// This test lingers in the menu for longer than the watchdog's two 20 s
// windows, then picks with Up/Down and Enter exactly as the tester did, and
// requires the conversation to carry on (the next replies, or the end of the
// conversation) with no "didn't respond" line.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const buildOut = resolve(repoRoot, "vendor", "scummvm-web", "build-emscripten");
const WASM = resolve(buildOut, "scummvm.wasm");
const PACKET = resolve(buildOut, "data", "games", "drascula", "Packet.001");

const ROOM_62_SHORT = "stone tavern with a wooden floor";
const LIVE = "#live-region";
const MENU = "#choice-menu";
const LINGER_MS = 50_000; // longer than the watchdog's two 20 s windows

async function lastLine(page: Page): Promise<string> {
  return page.evaluate(() => window.__ghostlight?.lastLine ?? "");
}

async function waitPhase(page: Page, phases: string[], timeout = 120_000): Promise<void> {
  await page.waitForFunction(
    (want) => want.includes(window.__ghostlight?.phase ?? ""),
    phases,
    { timeout },
  );
}

test.describe("live: lingering in a reply menu", () => {
  test.skip(
    !existsSync(WASM) || !existsSync(PACKET),
    `live build not found under ${buildOut}; run scripts/fetch.sh and scripts/build-web.sh`,
  );

  test("a pick made after 50 s in the drunk's menu still goes through", async ({ page }) => {
    test.setTimeout(240_000);
    const spoken: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("[say] ")) spoken.push(t.slice(6));
    });

    await page.goto("/index.html?live&speechlog");
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(LIVE)).toContainText(ROOM_62_SHORT, { timeout: 90_000 });
    await waitPhase(page, ["ready"], 90_000);

    // Focus the drunk ("drunk, N of M") and talk to him.
    let onDrunk = false;
    for (let i = 0; i < 12 && !onDrunk; i++) {
      if (/^drunk, \d+ of/i.test(await lastLine(page))) onDrunk = true;
      else await page.keyboard.press("ArrowRight");
    }
    expect(onDrunk, "never reached the drunk in the room list").toBe(true);
    await page.keyboard.press("Enter");
    await waitPhase(page, ["choice"], 60_000);
    await expect(page.locator(MENU)).toBeVisible();

    // Linger like a screen-reader user listening to the options.
    await page.keyboard.press("r");
    await page.waitForTimeout(LINGER_MS);
    expect(await page.evaluate(() => window.__ghostlight?.phase)).toBe("choice");

    // Down, Down, Enter: pick option 3.
    const spokenBefore = spoken.length;
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // The conversation carries on: the next replies are offered (menu ready
    // again, not busy) or it ends (menu hidden, phase ready).
    await page.waitForFunction(
      (sel) => {
        const m = document.querySelector(sel) as HTMLElement | null;
        if (!m) return false;
        const hidden = m.hidden || getComputedStyle(m).display === "none";
        const busy = m.getAttribute("aria-busy") === "true";
        const phase = window.__ghostlight?.phase;
        return (hidden && phase === "ready") || (!hidden && !busy && phase === "choice");
      },
      MENU,
      { timeout: 60_000 },
    );
    const after = spoken.slice(spokenBefore).join(" | ");
    expect(after.toLowerCase()).not.toContain("didn't respond");
  });

  // VoiceOver tester, 9 Nov 17:21: after picking option 3 the engine re-offered
  // the SAME four options and the menu rebuilt itself, jumping focus to option 1
  // and re-announcing "Pick a reply", which sounded like the menu restarting.
  // Same options back: focus stays on the picked option, nothing re-announced,
  // and the picked option is marked "already asked".
  test("the same replies coming back keep focus where the player was", async ({ page }) => {
    test.setTimeout(180_000);
    const spoken: string[] = [];
    page.on("console", (m) => {
      const t = m.text();
      if (t.startsWith("[say] ")) spoken.push(t.slice(6));
    });
    await page.goto("/index.html?live&speechlog");
    await expect(page.locator("#start-gate")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(LIVE)).toContainText(ROOM_62_SHORT, { timeout: 90_000 });
    await waitPhase(page, ["ready"], 90_000);
    let onDrunk = false;
    for (let i = 0; i < 12 && !onDrunk; i++) {
      if (/^drunk, \d+ of/i.test(await lastLine(page))) onDrunk = true;
      else await page.keyboard.press("ArrowRight");
    }
    expect(onDrunk, "never reached the drunk in the room list").toBe(true);
    await page.keyboard.press("Enter");
    await waitPhase(page, ["choice"], 60_000);
    await expect(page.locator(MENU)).toBeVisible();
    const before = await page.locator(`${MENU} [role=option]`).allTextContents();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const promptsBefore = spoken.filter((l) => l.startsWith("Pick a reply")).length;
    await page.keyboard.press("Enter");
    await expect(page.locator(MENU)).toHaveAttribute("aria-busy", "true");
    await page.waitForFunction(
      (sel) => {
        const m = document.querySelector(sel) as HTMLElement | null;
        return !!m && !m.hidden && m.getAttribute("aria-busy") !== "true" && window.__ghostlight?.phase === "choice";
      },
      MENU,
      { timeout: 60_000 },
    );
    const after = await page.locator(`${MENU} [role=option]`).allTextContents();
    test.skip(
      after.map((t) => t.replace(", already asked", "")).join("|") !== before.join("|"),
      "the engine offered a different set this time; the same-set path was not exercised",
    );
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-posinset"));
    expect(focused).toBe("3");
    expect(spoken.filter((l) => l.startsWith("Pick a reply")).length).toBe(promptsBefore);
    await expect(page.locator(`${MENU} [role=option]`).nth(2)).toContainText("already asked");
  });
});

