import { expect, test, type Page } from "@playwright/test";

// Tester feedback, 16 Nov: "how do you quit the game if you want to quit the
// game and go back to a previous chapter?" Q (twice) saves and goes back to the
// start screen; the start screen lists every chapter the player has reached
// (chapter saves in slots 92 to 96) and chapter 1 as a new game.

/** Seed save files into the IndexedDB store the page's save probe reads. */
async function seedSaves(page: Page, names: string[]): Promise<void> {
  await page.goto("/?replay=tavern");
  await page.evaluate(
    (names) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("/saves", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("FILE_DATA");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("FILE_DATA", "readwrite");
          for (const n of names)
            tx.objectStore("FILE_DATA").put({ contents: new Uint8Array() }, `/saves/${n}`);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    names,
  );
}

test.describe("Choose a chapter on the start screen", () => {
  test("lists chapter 1 and every chapter reached, and Back returns to Continue", async ({ page }) => {
    await seedSaves(page, ["drascula.001", "drascula.093", "drascula.092"]);
    await page.goto("/");
    await expect(page.locator("#continue-button")).toBeVisible();
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("#resume-choice button")].map((b) => b.id),
    );
    expect(order).toEqual(["continue-button", "new-game-button", "chapters-button", "guide-button"]);

    await page.locator("#chapters-button").click();
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll("#chapter-choice button")].map((b) => b.id),
    );
    expect(ids).toEqual(["chapter-1", "chapter-2", "chapter-3", "chapter-back"]);
    await expect(page.locator("#chapter-1")).toHaveText("Chapter 1: The inn");
    await expect(page.locator("#chapter-2")).toHaveText("Chapter 2: The village");
    await expect(page.locator("#chapter-3")).toHaveText(/^Chapter 3/);
    await expect(page.locator("#chapter-1")).toBeFocused();
    await expect(page.locator("#live-region")).toContainText("Choose a chapter: 3 to choose from");

    await page.locator("#chapter-back").click();
    await expect(page.locator("#continue-button")).toBeVisible();
  });

  test("no chapter saves, no chapter button", async ({ page }) => {
    await seedSaves(page, ["drascula.001"]);
    await page.goto("/");
    await expect(page.locator("#continue-button")).toBeVisible();
    await expect(page.locator("#chapters-button")).toHaveCount(0);
  });
});

test.describe("Q quits to the start screen", () => {
  test("the first Q only explains; any other key disarms it", async ({ page }) => {
    await page.goto("/?replay=tavern");
    await page.keyboard.press("Enter");
    await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#live-region")).toContainText("Inn bar");

    await page.keyboard.press("q");
    await expect(page.locator("#live-region")).toContainText("Press Q again to save and go back to the start screen");
    await page.keyboard.press("l"); // another key: disarmed
    await expect(page.locator("#live-region")).not.toContainText("Press Q again");
    await page.keyboard.press("q");
    await expect(page.locator("#live-region")).toContainText("Press Q again");
  });
});

test("the first F1 page mentions the inventory", async ({ page }) => {
  await page.goto("/?replay=tavern");
  await page.keyboard.press("Enter");
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
  await page.keyboard.press("F1");
  await expect(page.locator("#live-region")).toContainText("Tab opens your inventory.");
});
