import { expect, test, type Page } from "@playwright/test";
import { HOLD_AFTER_LOAD_MS } from "../src/ui/hold-focus.js";

// Safari + VoiceOver (15 Nov 2026): with VoiceOver on as the page loads, its
// automatic page reading moves keyboard focus along the page and leaves it on
// the last thing read, the Source code link. On the Continue gate and the
// guide offer, Enter then opened the link. Now Enter off the gate's buttons
// does the main button's action there, as it already begins the game anywhere
// on the fresh Start gate. These simulate where VoiceOver leaves focus (the
// link, or the page body), with no screen reader needed.

async function seedSave(page: Page): Promise<void> {
  await page.goto("/?replay=tavern");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("/saves", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("FILE_DATA");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("FILE_DATA", "readwrite");
          tx.objectStore("FILE_DATA").put({ contents: new Uint8Array() }, "/saves/drascula.001");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** Record clicks on a gate button without letting the page boot the engine. */
async function recordClicks(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const w = window as unknown as { __clicked?: number };
    w.__clicked = 0;
    document.getElementById(id)!.addEventListener(
      "click",
      (e) => {
        w.__clicked = (w.__clicked ?? 0) + 1;
        e.stopImmediatePropagation();
      },
      { capture: true },
    );
  }, id);
}

const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clicked?: number }).__clicked ?? 0);

test.describe("Enter off the buttons does the gate's main action", () => {
  test("Continue gate: Enter on the Source code link continues, the link isn't followed", async ({ page }) => {
    await seedSave(page);
    await page.goto("/");
    await expect(page.locator("#continue-button")).toBeVisible();
    await recordClicks(page, "continue-button");
    await page.locator('a[href="/source/"]').focus();
    await page.keyboard.press("Enter");
    expect(await clicks(page)).toBe(1);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("Continue gate: Enter with focus on the page body continues", async ({ page }) => {
    await seedSave(page);
    await page.goto("/");
    await expect(page.locator("#continue-button")).toBeVisible();
    await recordClicks(page, "continue-button");
    // Past the load-time focus hold (src/ui/hold-focus.ts), which would put
    // focus straight back on Continue.
    await page.waitForTimeout(HOLD_AFTER_LOAD_MS + 300);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Enter");
    expect(await clicks(page)).toBe(1);
  });

  test("Continue gate: Space or a letter off the buttons does nothing", async ({ page }) => {
    await seedSave(page);
    await page.goto("/");
    await expect(page.locator("#continue-button")).toBeVisible();
    await recordClicks(page, "continue-button");
    // Past the load-time focus hold (src/ui/hold-focus.ts), which would put
    // focus straight back on Continue.
    await page.waitForTimeout(HOLD_AFTER_LOAD_MS + 300);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Space");
    await page.keyboard.press("n");
    expect(await clicks(page)).toBe(0);
    await expect(page.locator("#continue-button")).toBeVisible();
  });

  test("Guide offer: Enter on the Source code link starts the guide", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#guide-start")).toBeVisible();
    await page.locator('a[href="/source/"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Moving around/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });
});
