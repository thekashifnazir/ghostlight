import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

// Two tester-facing aids, both driven on the replay path (?replay=<fixture>) so
// no wasm build is needed:
//
//  1. '?' (Shift+/) reads the controls help exactly like F1 — on the start gate
//     (without starting) and in-game — and never collides with '/', which opens
//     the command box.
//  2. ?speechlog mirrors the live region and focus changes to the browser
//     console as `[say] …` / `[focus] …`, for a tester that can read the console
//     but not the inside of the role="application" element. Off without the param.

const LIVE = "#live-region";
const GATE = "#start-gate";

function live(page: Page) {
  return page.locator(LIVE);
}

/** Load a fixture, press the start key, and wait for the gate to hide. */
async function start(page: Page, fixture: string, query = ""): Promise<void> {
  await page.goto(`/?replay=${fixture}${query}`);
  await expect(page.locator(GATE)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(GATE)).toBeHidden({ timeout: 10_000 });
}

// The distinctive opening clause of the help (shared by the short and full
// pages), enough to identify the help.
const HELP_OPENING = "Left and Right cycle the things, people and exits in the room.";
// The updated tail that names the '?' alias (present on both pages).
const HELP_QUESTION_MARK = "F1 or question mark reads this help.";
// The short page ends by inviting a second press; the full page does not.
const HELP_MORE = "Press F1 again for more.";
// A line only the full page carries (the sonar keys), so it tells the two
// pages apart.
const HELP_FULL_ONLY = "scans the room as sound";

test.describe("'?' reads the controls help (F1 alias)", () => {
  test("on the start gate, '?' reads help and does NOT start", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator(GATE)).toBeVisible();

    await page.keyboard.press("?"); // Shift+/ → key "?"

    // The gate stays up (help did not start the game) and the help is spoken.
    await expect(page.locator(GATE)).toBeVisible();
    await expect(live(page)).toContainText(HELP_OPENING);
    await expect(live(page)).toContainText(HELP_QUESTION_MARK);

    // The game surface was not activated: #game is still a plain div.
    const role = await page.evaluate(
      () => document.getElementById("game")?.getAttribute("role") ?? null,
    );
    expect(role).toBeNull();
  });

  test("in-game, '?' reads help just like F1", async ({ page }) => {
    await start(page, "tavern");
    // Wait for the room reading to settle, so '?' replaces a stable line rather
    // than racing the room reading that would otherwise clobber the help.
    await expect(live(page)).toContainText("Inn bar");
    await page.keyboard.press("?");
    await expect(live(page)).toContainText(HELP_OPENING);
    await expect(live(page)).toContainText(HELP_QUESTION_MARK);
  });
});

test.describe("two-tier help (Fix 2)", () => {
  test("first F1 reads the short page, a second F1 reads the full list", async ({
    page,
  }) => {
    await start(page, "tavern");
    await expect(live(page)).toContainText("Inn bar");

    // First press: the short page — the core keys, inviting a second press, and
    // NOT the full list's sonar section.
    await page.keyboard.press("F1");
    await expect(live(page)).toContainText(HELP_OPENING);
    await expect(live(page)).toContainText(HELP_MORE);
    await expect(live(page)).not.toContainText(HELP_FULL_ONLY);

    // Second consecutive press: the full list, which no longer ends with the
    // "again for more" invitation.
    await page.keyboard.press("F1");
    await expect(live(page)).toContainText(HELP_FULL_ONLY);
    await expect(live(page)).not.toContainText(HELP_MORE);
  });

  test("a non-help key between presses resets back to the short page", async ({
    page,
  }) => {
    await start(page, "tavern");
    await expect(live(page)).toContainText("Inn bar");

    // Expand to the full page, then press a plain navigation key, then F1 again:
    // it starts from the short page rather than toggling back to the full list.
    await page.keyboard.press("F1"); // short
    await page.keyboard.press("F1"); // full
    await expect(live(page)).toContainText(HELP_FULL_ONLY);
    await page.keyboard.press("ArrowRight"); // any other key resets the page
    await page.keyboard.press("F1"); // short again, not full
    await expect(live(page)).toContainText(HELP_MORE);
    await expect(live(page)).not.toContainText(HELP_FULL_ONLY);
  });

  test("'/' still opens the command box, not the help", async ({ page }) => {
    await start(page, "tavern");
    await expect(live(page)).toContainText("Inn bar");
    await page.keyboard.press("/");
    // The command box becomes visible; the help is not read.
    await expect(page.locator("#command-box")).toBeVisible();
    await expect(live(page)).not.toContainText(HELP_OPENING);
  });
});

test.describe("?speechlog console mirror", () => {
  /** Collect every console.log line the page emits. */
  function captureConsole(page: Page): string[] {
    const lines: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "log") lines.push(msg.text());
    });
    return lines;
  }

  test("mirrors live-region lines as [say] and focus as [focus]", async ({
    page,
  }) => {
    const logs = captureConsole(page);
    await start(page, "tavern", "&speechlog");

    // The room reading reached the live region, so it was mirrored as [say].
    // Starting also moved focus to the #game role="application" element, so that
    // focus change was mirrored as [focus].
    await expect
      .poll(() => logs.some((l) => l.startsWith("[say] ") && l.includes("Inn bar")))
      .toBe(true);
    await expect
      .poll(() => logs.includes("[focus] Ghostlight game (application)"))
      .toBe(true);
  });

  test("mirrors a menu item focus with its role and position", async ({ page }) => {
    const logs = captureConsole(page);
    await start(page, "tavern", "&speechlog");

    // Wait for the room to be read, so list mode is live and a thing is focused.
    await expect(live(page)).toContainText("Inn bar");
    // Open the verb menu (V) on the focused thing: its first roving menuitem
    // gets focus, carrying aria-posinset=1 / aria-setsize=4.
    await page.keyboard.press("v");
    await expect
      .poll(() => logs.some((l) => l === "[focus] Open (menuitem, 1 of 4)"))
      .toBe(true);
  });

  test("is OFF without the param: no [say]/[focus] lines", async ({ page }) => {
    const logs = captureConsole(page);
    await start(page, "tavern"); // no &speechlog

    // Give the room reading and focus move time to have fired.
    await expect(live(page)).toContainText("Inn bar");
    expect(logs.some((l) => l.startsWith("[say] "))).toBe(false);
    expect(logs.some((l) => l.startsWith("[focus] "))).toBe(false);
  });
});
