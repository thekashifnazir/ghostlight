import { expect, test, type Page } from "@playwright/test";

// Drives the real page through the replay adapter (?replay=drunk-choices), with
// no live engine, to prove the keyboard choice menu works end to end: talking
// to the drunk opens a choice menu, the menu is announced and focuses option 1,
// the arrows move focus, a number key / Enter picks an option, and picking
// sends `choose n` — which the replay adapter only emits its reply for when the
// serialized command matches the recorded `choose 1`. Seeing the drunk's reply
// proves the right choose command was sent and the conversation continued.
//
// This is the regression guard for the gap the live survey found: when a
// conversation offered choices there was NO keyboard way to pick one, so a
// blind player talking to the drunk was stuck. A mismatch would instead surface
// a "replay mismatch" line in the live region.

const LIVE = "#live-region";
const CHOICE_MENU = "#choice-menu";

async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss gate, start adapter (keyboard)
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
}

function live(page: Page) {
  return page.locator(LIVE);
}

/** Step list focus right until the live line names the drunk. */
async function focusDrunk(page: Page): Promise<void> {
  let onDrunk = false;
  for (let i = 0; i < 14 && !onDrunk; i++) {
    await page.keyboard.press("ArrowRight");
    const t = ((await live(page).textContent()) ?? "").toLowerCase();
    if (t.includes("drunk")) onDrunk = true;
  }
  expect(onDrunk, "never reached the drunk in the room list").toBe(true);
}

test.describe("conversation choice menu (replay)", () => {
  test("talking to the drunk opens the choice menu, announced and focused on option 1", async ({
    page,
  }) => {
    await start(page, "drunk-choices");
    await focusDrunk(page);

    // Enter on the drunk sends `talk 53`, which the recording answers with a
    // choice menu (A11Y_CHOICES + phase 'choice').
    await page.keyboard.press("Enter");

    // The menu is visible and announced as the menu name and count only — NOT
    // the numbered option list (that would double-speak the focused option).
    await expect(page.locator(CHOICE_MENU)).toBeVisible();
    await expect(live(page)).toContainText("Choices, 3 options.");

    // The menu is a role=listbox with three roving-focus options; option 1 is
    // focused, selected, and carries aria-posinset/aria-setsize for the reader.
    // The listbox role (not role=menu) stops VoiceOver adding its wrong menu
    // hint ("Control-Option-Space to choose, Escape to close").
    await expect(page.locator(CHOICE_MENU)).toHaveAttribute("role", "listbox");
    const items = page.locator(`${CHOICE_MENU} [role="option"]`);
    await expect(items).toHaveCount(3);
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveText("HI BOSS, HOW ARE YOU?");
    await expect(items.first()).toHaveAttribute("aria-posinset", "1");
    await expect(items.first()).toHaveAttribute("aria-setsize", "3");
    await expect(items.first()).toHaveAttribute("aria-selected", "true");
  });

  test("arrows move focus silently; R repeats the options as one line", async ({
    page,
  }) => {
    await start(page, "drunk-choices");
    await focusDrunk(page);
    await page.keyboard.press("Enter"); // open the menu
    await expect(page.locator(CHOICE_MENU)).toBeVisible();

    const items = page.locator(`${CHOICE_MENU} [role="option"]`);
    // Down moves roving focus to option 2 (no live-region write for the move;
    // the focused button is what the screen reader reads).
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.first()).toBeFocused();

    // R repeats all the options as one composed line.
    await page.keyboard.press("r");
    await expect(live(page)).toContainText(
      "1. HI BOSS, HOW ARE YOU? 2. GIVE ME A DRINK. 3. GOODBYE.",
    );
    // The menu is still open (R only repeats; it does not pick or close).
    await expect(page.locator(CHOICE_MENU)).toBeVisible();
  });

  test("Escape does not close the menu; it re-states how to choose", async ({
    page,
  }) => {
    await start(page, "drunk-choices");
    await focusDrunk(page);
    await page.keyboard.press("Enter");
    await expect(page.locator(CHOICE_MENU)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(live(page)).toContainText(
      "Pick an option with Up and Down, then Enter.",
    );
    // Still open — the engine is waiting for a pick.
    await expect(page.locator(CHOICE_MENU)).toBeVisible();
  });

  test("pressing 1 picks option 1, sends choose 1, and the conversation continues", async ({
    page,
  }) => {
    await start(page, "drunk-choices");
    await focusDrunk(page);
    await page.keyboard.press("Enter"); // open the menu
    await expect(page.locator(CHOICE_MENU)).toBeVisible();

    // The number key 1 picks option 1 directly. The recording's next command is
    // `choose 1`; the page only gets the drunk's reply if the serialized
    // command equals it, so the reply proves `choose 1` was sent and matched.
    await page.keyboard.press("1");

    // The conversation continues: the drunk replies, and the engine leaves the
    // choice phase (A11Y_PHASE control), so the menu closes.
    await expect(live(page)).toContainText("NOT BAD, AND YOU?");
    await expect(live(page)).not.toContainText("mismatch");
    await expect(page.locator(CHOICE_MENU)).toBeHidden();
  });

  test("Enter on the focused option also picks it (choose 1) and continues", async ({
    page,
  }) => {
    await start(page, "drunk-choices");
    await focusDrunk(page);
    await page.keyboard.press("Enter"); // open the menu (option 1 focused)
    await expect(page.locator(CHOICE_MENU)).toBeVisible();

    // Enter picks the focused option (option 1), which serializes to `choose 1`.
    await page.keyboard.press("Enter");
    await expect(live(page)).toContainText("NOT BAD, AND YOU?");
    await expect(live(page)).not.toContainText("mismatch");
    await expect(page.locator(CHOICE_MENU)).toBeHidden();
  });

  test("a typed bare number in the command box also picks a choice while the menu is open", async ({
    page,
  }) => {
    // parseContext.pendingChoice reflects the open menu, so a typed bare number
    // resolves to a choice (parser 'choice' match), the same pick the number
    // keys make. This is the typed route the gap report asked for ("typed
    // 'choose 2' also works" — the parser's pending-choice path takes the bare
    // number).
    await start(page, "drunk-choices");
    await focusDrunk(page);
    await page.keyboard.press("Enter"); // open the menu
    await expect(page.locator(CHOICE_MENU)).toBeVisible();

    // Open the command box and type the bare number 1. With pendingChoice true
    // it parses to choose 1, which serializes to `choose 1`, matching the
    // recording, and the drunk replies.
    await page.keyboard.press("/");
    const input = page.locator("#command-box-input");
    await expect(input).toBeFocused();
    await input.fill("1");
    await page.keyboard.press("Enter");

    await expect(live(page)).toContainText("NOT BAD, AND YOU?");
    await expect(live(page)).not.toContainText("mismatch");
  });

  test("the game surface is named after the room, so returning focus says where the player is", async ({
    page,
  }) => {
    // Issue 2: when the choice menu closes, focus returns to #game. Its
    // accessible name must name the room (not a bare "Ghostlight game, empty
    // application"), so a screen reader says where the player is in one short
    // phrase. The drunk fixture is in the Inn bar (room 62).
    await start(page, "drunk-choices");
    await focusDrunk(page);

    const game = page.locator("#game");
    await expect(game).toHaveAttribute("aria-label", "Ghostlight game, Inn bar");

    // Pick option 1: the menu closes and focus returns to #game, whose name now
    // reads the room — a short phrase, not the full room text.
    await page.keyboard.press("Enter"); // open the menu (option 1 focused)
    await expect(page.locator(CHOICE_MENU)).toBeVisible();
    await page.keyboard.press("Enter"); // pick option 1
    await expect(page.locator(CHOICE_MENU)).toBeHidden();
    await expect(game).toBeFocused();
    await expect(game).toHaveAttribute("aria-label", "Ghostlight game, Inn bar");
  });
});
