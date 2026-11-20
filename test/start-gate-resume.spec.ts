import { expect, test, type Page } from "@playwright/test";

// Regression for spike 10, "VoiceOver + Safari scripted run": after a reload
// with a save, VoiceOver landed on the Start button and Space did not resume,
// because the page rendered Start on first paint and only hid it (and moved
// focus to Continue) after an async save probe — a move Safari/VoiceOver does
// not follow. The fix decides whether a save exists BEFORE the gate renders any
// interactive content, so Start is never in the DOM/accessibility tree when
// Continue / New game are shown, puts Continue first in reading order, and
// keeps the #game element out of the tab order and unresponsive to keys until
// Start. These are page behaviours (DOM, focus, IndexedDB probe) that need no
// wasm build, so they run in the replay suite like the other player specs.

const SAVE_DIR = "/saves";

/**
 * Seed a Drascula save into the IndexedDB database the page's probeSaves()
 * reads: a database named "/saves" with a FILE_DATA object store holding a key
 * under "/saves/" that matches drascula.NNN (IDBFS's on-disk layout). Seeded on
 * the app's OWN origin (not about:blank, where Chromium denies IndexedDB with
 * "access to the Indexed Database API is denied in this context"): navigate to
 * the app first, write the save, then the caller reloads so probeSaves() finds
 * it on first render.
 */
async function seedSave(page: Page, slot = 1): Promise<void> {
  await page.goto("/?replay=tavern");
  await page.evaluate(
    ({ dir, slot }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dir, 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("FILE_DATA")) {
            db.createObjectStore("FILE_DATA");
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("FILE_DATA", "readwrite");
          const name = `drascula.${String(slot).padStart(3, "0")}`;
          // IDBFS keys FILE_DATA by absolute path with an out-of-line key; the
          // value shape is irrelevant to the probe, which only reads keys.
          tx.objectStore("FILE_DATA").put({ contents: new Uint8Array() }, `${dir}/${name}`);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { dir: SAVE_DIR, slot },
  );
}

test.describe("fresh visit (no save): Start only", () => {
  test("the gate shows a single Start button and no Continue", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator("#start-gate")).toBeVisible();

    // Exactly one Start button, no Continue / New game anywhere.
    await expect(page.locator("#start-button")).toBeVisible();
    await expect(page.locator("#continue-button")).toHaveCount(0);
    await expect(page.locator("#resume-choice")).toHaveCount(0);

    // Start holds focus so the first key or Enter begins the game.
    const onStart = await page.evaluate(
      () => document.activeElement === document.getElementById("start-button"),
    );
    expect(onStart).toBe(true);
  });
});

test.describe("#game is inert before Start", () => {
  test("not in the accessibility tree, not focusable, until Start", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await expect(page.locator("#start-gate")).toBeVisible();

    // Before Start: a plain div. No application role, no accessible name, and
    // no tabindex — so a screen reader cannot land on it and it is out of the
    // Tab order (spike 10 saw Shift+Tab reach it and it answered a key before
    // Start). Programmatically focusing it is a no-op because it is not
    // focusable, so focus does NOT move to #game.
    const before = await page.evaluate(() => {
      const g = document.getElementById("game")!;
      g.focus(); // a no-op on a non-focusable element
      return {
        role: g.getAttribute("role"),
        label: g.getAttribute("aria-label"),
        hasTabIndex: g.hasAttribute("tabindex"),
        focusedGame: document.activeElement === g,
      };
    });
    expect(before.role).toBeNull();
    expect(before.label).toBeNull();
    expect(before.hasTabIndex).toBe(false);
    expect(before.focusedGame).toBe(false);

    // After Start: #game becomes the role=application surface and holds focus,
    // so NVDA/JAWS switch to focus mode and keys reach the game.
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
    const after = await page.evaluate(() => {
      const g = document.getElementById("game")!;
      return {
        isActive: document.activeElement === g,
        role: g.getAttribute("role"),
        label: g.getAttribute("aria-label"),
        tabindex: g.getAttribute("tabindex"),
      };
    });
    expect(after.isActive).toBe(true);
    expect(after.role).toBe("application");
    expect(after.label).toMatch(/^Ghostlight game(, .+)?$/); // room name added on room entry
    expect(after.tabindex).toBe("-1");
  });
});

test.describe("returning visit (save present): Continue, no Start", () => {
  test("Start is never in the DOM; Continue is first and focused", async ({ page }) => {
    await seedSave(page, 1);
    await page.goto("/");
    await expect(page.locator("#start-gate")).toBeVisible();

    // The core regression: with a save present, the Start button must never be
    // in the DOM at all, so Safari/VoiceOver cannot latch onto it.
    await expect(page.locator("#start-button")).toHaveCount(0);

    // Continue and New game are shown, Continue first in reading order.
    await expect(page.locator("#continue-button")).toBeVisible();
    await expect(page.locator("#new-game-button")).toBeVisible();
    const order = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("#resume-choice button")].map(
        (b) => b.id,
      );
      return ids;
    });
    expect(order).toEqual(["continue-button", "new-game-button", "guide-button"]);

    // Continue holds focus, so Space/Enter resumes with no focus move required.
    const onContinue = await page.evaluate(
      () => document.activeElement === document.getElementById("continue-button"),
    );
    expect(onContinue).toBe(true);

    // The choice is announced as functional text in the live region (R3.3).
    await expect(page.locator("#live-region")).toContainText("saved game");
  });
});

// Continue resumes the newest save (tester report, 20 Nov 2026). A manual save
// (slot 1) beat the autosave (slot 99) whatever their age, so a player who
// saved once in chapter 4 and played on was put back in chapter 4 by Continue.
// IDBFS keeps each file's time in FILE_DATA (with a `timestamp` index), so the
// probe can pick the newest, as the load key does. Chapter saves (slots 92 to
// 96) still never win over a progress save.
test.describe("Continue picks the newest save", () => {
  /** Seed saves the way IDBFS stores them: a timestamp per file, and its index. */
  async function seedTimed(page: Page, saves: { slot: number; at: number }[]): Promise<void> {
    await page.goto("/?replay=tavern");
    await page.evaluate(
      ({ dir, saves }) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(dir, 21);
          open.onupgradeneeded = () => {
            const db = open.result;
            const store = db.objectStoreNames.contains("FILE_DATA")
              ? open.transaction!.objectStore("FILE_DATA")
              : db.createObjectStore("FILE_DATA");
            if (!store.indexNames.contains("timestamp")) {
              store.createIndex("timestamp", "timestamp", { unique: false });
            }
          };
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("FILE_DATA", "readwrite");
            for (const s of saves) {
              const name = `drascula.${String(s.slot).padStart(3, "0")}`;
              tx.objectStore("FILE_DATA").put(
                { timestamp: new Date(s.at), mode: 33206, contents: new Uint8Array() },
                `${dir}/${name}`,
              );
            }
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      { dir: SAVE_DIR, saves },
    );
  }

  const probe = (page: Page): Promise<{ hasSave: boolean; latestSlot?: number; chapters?: number[] }> =>
    page.evaluate(async () => {
      const mod = await import("/engine/persistence.ts" as string);
      return mod.probeSaves();
    });

  const at = (h: number): number => Date.UTC(2026, 10, 20, h, 0);

  test("an autosave newer than the manual save wins", async ({ page }) => {
    await seedTimed(page, [
      { slot: 1, at: at(10) },
      { slot: 99, at: at(11) },
    ]);
    expect(await probe(page)).toEqual({ hasSave: true, latestSlot: 99, chapters: [] });
  });

  test("a manual save newer than the autosave wins", async ({ page }) => {
    await seedTimed(page, [
      { slot: 99, at: at(10) },
      { slot: 1, at: at(11) },
    ]);
    expect(await probe(page)).toEqual({ hasSave: true, latestSlot: 1, chapters: [] });
  });

  test("a newer chapter save never wins over a progress save", async ({ page }) => {
    await seedTimed(page, [
      { slot: 1, at: at(9) },
      { slot: 99, at: at(10) },
      { slot: 95, at: at(11) },
    ]);
    expect(await probe(page)).toEqual({ hasSave: true, latestSlot: 99, chapters: [5] });
  });
});
