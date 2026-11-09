import { expect, test, type Page } from "@playwright/test";

// Drives the real page through the replay adapter (?replay=<fixture>), with no
// live engine, to verify the hint key wiring end to end (hints-and-ghost
// task 12). Assertions read the live region text, exactly what a screen reader
// conveys. Audio is silent in this environment (no cached mp3s), which is the
// intended text-only fallback (R6.5); the text is the hint and must be complete
// on its own.

const LIVE = "#live-region";

async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter");
  // 20 s gate wait: the start gate can take longer to clear under parallel
  // load, which flaked the "H with nothing offered" case at 10 s. No behaviour
  // change, only a more tolerant wait for the same settled state.
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 20_000 });
}

function live(page: Page) {
  return page.locator(LIVE);
}

test.describe("hint key: tiers in order", () => {
  test("H announces the nudge, then the clue, then the answer", async ({ page }) => {
    await start(page, "ch2-vending"); // chapter 2, room 15, flag 20 = 0

    // The offered target in room 15 is ch2.handbag (no offered milestone lists
    // room 15, so required-over-optional then file order picks it).
    await page.keyboard.press("h");
    await expect(live(page)).toContainText(
      "B.J. was staying in your room. Did she leave anything behind?",
    );
    await page.keyboard.press("h");
    await expect(live(page)).toContainText(
      "Something in the guest bedroom can be opened.",
    );
    await page.keyboard.press("h");
    await expect(live(page)).toContainText(
      "In the guest bedroom, open the trunk under the window.",
    );
    // Asking again repeats the answer, every time, never cutting off (R3.3).
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("h");
      await expect(live(page)).toContainText(
        "In the guest bedroom, open the trunk under the window.",
      );
    }
  });
});

test.describe("hint key: nothing to hint at", () => {
  test("H with nothing offered speaks the 'nothing to hint at' line", async ({
    page,
  }) => {
    // The ch3-no-hints fixture boots into a chapter-3 room. The pack has no
    // chapter-3 milestones and selectTarget drops earlier-chapter ones, so the
    // offered set is empty: pressing H returns { kind: "none" } and the player
    // speaks NO_HINT_TEXT end to end (R2.6, R5.3).
    await start(page, "ch3-no-hints");

    await page.keyboard.press("h");
    await expect(live(page)).toContainText(
      "There is nothing to hint at right now.",
    );
  });
});

test.describe("hint key: folded flags drive the reached set", () => {
  test("a diff that sets a milestone's flag stops the ghost hinting at it", async ({ page }) => {
    await start(page, "tavern"); // chapter 1, room 62, flag 0 = 0

    // Before progress: the ghost hints at ch1.room (rooms include 62).
    await page.keyboard.press("h");
    await expect(live(page)).toContainText("It's late, and you'll need somewhere to sleep.");

    // Replay the fixture's recorded commands in order (look 52, look 100,
    // talk 52). talk 52's diff sets flag 0 = 1, which the player folds forward,
    // reaching ch1.room. All three are list-mode actions: Down = look, Up = the
    // NPC's primary verb (talk).
    await examine(page, "bartender"); // look 52
    await examine(page, "skull"); // look 100
    await interact(page, "bartender"); // talk 52 -> flag 0 = 1

    // Now ch1.room is reached, so the hint no longer mentions sleeping where it
    // started; the ghost moves on to the next offered milestone (ch1.bed).
    await page.keyboard.press("h");
    const line = (await live(page).textContent()) ?? "";
    expect(line).not.toContain("It's late, and you'll need somewhere to sleep.");
    expect(line).toContain("You've got a room. Time for bed.");
  });
});

/** Cycle the list with Right until the focused line starts with `name`. */
async function focusHotspot(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 16; i++) {
    const t = (await live(page).textContent()) ?? "";
    if (t.toLowerCase().startsWith(name.toLowerCase())) return;
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`hotspot "${name}" not found by cycling`);
}

/** Focus `name` and examine it (Down = look). */
async function examine(page: Page, name: string): Promise<void> {
  await focusHotspot(page, name);
  await page.keyboard.press("ArrowDown");
}

/** Focus `name` and interact (Up = the hotspot's primary verb). */
async function interact(page: Page, name: string): Promise<void> {
  await focusHotspot(page, name);
  await page.keyboard.press("ArrowUp");
}
