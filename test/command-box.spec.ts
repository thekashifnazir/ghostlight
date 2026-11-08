import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Drives the typed command box through the real page over the replay adapter
// (?replay=ch2-vending), with no live engine. The box's resolved command is
// observed the same way the other player specs observe a sent command: the
// replay adapter only emits the recorded diff when the player's serialized
// command matches the recording's next line, so seeing the vending diff's
// result in the live region proves "use coins on machine" serialized to the
// recorded `use 18 188`. A mismatch would instead surface a replay error.

const LIVE = "#live-region";
const BOX = "#command-box";
const INPUT = "#command-box-input";

async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss gate, start adapter
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
}

function live(page: Page) {
  return page.locator(LIVE);
}

test.describe("typed command box", () => {
  test('"/" opens a labelled input and "use coins on machine" sends use 18 188', async ({
    page,
  }) => {
    await start(page, "ch2-vending");

    // The recording's first command is `look 188` (examine the machine), then
    // `use 18 188`. Examine the machine first via list mode so the replay
    // cursor is positioned at the vending use, exactly as a player would look
    // before acting. The machine (188) is the last hotspot left-to-right.
    await page.keyboard.press("ArrowLeft"); // wrap to the vending machine
    await expect(live(page)).toContainText("vending machine");
    await page.keyboard.press("ArrowDown"); // examine → look 188

    // "/" opens the box; the input is shown, labelled and focused.
    await page.keyboard.press("/");
    await expect(page.locator(BOX)).toBeVisible();
    const input = page.locator(INPUT);
    await expect(input).toBeFocused();
    // The input is named for assistive tech (its <label for>).
    await expect(input).toHaveAccessibleName(/type a command/i);

    // Type the phrase and send it. The recording's next command is now
    // `use 18 188`; the page only gets its diff if the parser serialized
    // exactly that, so the vending result proves the command sent.
    await input.fill("use coins on machine");
    await page.keyboard.press("Enter");

    // The replay adapter only emits the vending diff when the serialized
    // command equals the recorded `use 18 188`; a wrong command would instead
    // put a "replay mismatch" line here. The diff's last announced line (the
    // live region keeps only the newest) is the coins being spent, which proves
    // `use 18 188` was sent and matched.
    await expect(live(page)).toContainText("You no longer have the two coins.");
    // And it is NOT a replay mismatch (the command serialized correctly).
    await expect(live(page)).not.toContainText("mismatch");
    // The box closed after sending.
    await expect(page.locator(BOX)).toBeHidden();
  });

  test("Escape closes the box without sending and returns to the list", async ({
    page,
  }) => {
    await start(page, "ch2-vending");
    await page.keyboard.press("/");
    await expect(page.locator(BOX)).toBeVisible();
    await page.locator(INPUT).fill("use coins on machine");
    await page.keyboard.press("Escape");
    await expect(page.locator(BOX)).toBeHidden();
    // Back in list mode: Right cycles the hotspots again.
    await page.keyboard.press("ArrowRight");
    await expect(live(page)).toContainText(" of ");
  });

  test("an unknown phrase is announced, not sent, and the box stays open", async ({
    page,
  }) => {
    await start(page, "ch2-vending");
    await page.keyboard.press("/");
    await page.locator(INPUT).fill("polish the gargoyle");
    await page.keyboard.press("Enter");
    // Not understood: the present things are read back, and no engine error is
    // shown (nothing was sent). The box is still open to refine.
    await expect(live(page)).toContainText("vending machine");
    await expect(page.locator(BOX)).toBeVisible();
  });
});

test.describe("command box accessibility", () => {
  async function analyze(page: Page) {
    return new AxeBuilder({
      page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"],
    })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
  }

  test("command box open has no accessibility violations", async ({ page }) => {
    await start(page, "ch2-vending");
    await page.keyboard.press("/");
    await expect(page.locator(BOX)).toBeVisible();
    const results = await analyze(page);
    expect(results.violations).toEqual([]);
  });
});
