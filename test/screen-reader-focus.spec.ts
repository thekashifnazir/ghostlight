import { expect, test, type Page } from "@playwright/test";

// screen-reader-focus R7.1–R7.3: the page must put a screen reader into focus
// mode by keeping DOM focus on a role="application" element, keep it there when
// a transient overlay closes, and never let ScummVM's Web MIDI probe raise
// Chrome's "Control and reprogram MIDI devices" permission prompt.
//
// These are page behaviours (focus, MIDI, title) that need no wasm build, so
// they run in the replay suite (?replay=<fixture>) like the other player specs.
// Assertions read focus and a spy, exactly the observable surface that decides
// whether an NVDA/JAWS user can play or gets a surprise dialog.

/** Load a fixture, press the start key, and wait for the gate to hide. */
async function start(page: Page, fixture: string): Promise<void> {
  await page.goto(`/?replay=${fixture}`);
  await expect(page.locator("#start-gate")).toBeVisible();
  await page.keyboard.press("Enter"); // dismiss gate, start adapter (keyboard)
  await expect(page.locator("#start-gate")).toBeHidden({ timeout: 10_000 });
}

test.describe("focus mode on start (R7.1)", () => {
  test("after Start, the active element is the role=application game element", async ({
    page,
  }) => {
    await start(page, "tavern");
    // The game element holds focus, and its role is application — the switch
    // that moves NVDA and JAWS into focus mode so game keys reach the page.
    const active = await page.evaluate(() => ({
      isGame: document.activeElement === document.getElementById("game"),
      role: document.activeElement?.getAttribute("role") ?? null,
    }));
    expect(active.isGame).toBe(true);
    expect(active.role).toBe("application");
  });
});

test.describe("focus returns after a transient overlay (R7.2)", () => {
  test("Tab opens the inventory, Escape closes it, focus is back on the game element", async ({
    page,
  }) => {
    // ch2-vending boots with a non-empty inventory, so Tab actually opens the
    // inventory menu (an empty inventory would announce and not open).
    await start(page, "ch2-vending");

    // Tab opens the inventory: roving focus lands on a menuitem inside #game.
    await page.keyboard.press("Tab");
    await expect(page.locator("#inventory")).toBeVisible();
    const onMenuItem = await page.evaluate(
      () => document.activeElement?.getAttribute("role") === "menuitem",
    );
    expect(onMenuItem).toBe(true);

    // Escape closes the inventory and returns focus to the game element — NOT
    // to the document body (the bug spike 10 saw), so the reader stays in focus
    // mode and the next key still reaches the game.
    await page.keyboard.press("Escape");
    await expect(page.locator("#inventory")).toBeHidden();
    const backOnGame = await page.evaluate(
      () => document.activeElement === document.getElementById("game"),
    );
    expect(backOnGame).toBe(true);
  });
});

test.describe("no MIDI permission prompt (R7.3)", () => {
  test("the page's Web MIDI suppression leaves no callable live API at boot", async ({
    page,
  }) => {
    // A permission prompt can only arise from a real navigator.requestMIDIAccess
    // call. Install a spy BEFORE any page script runs: it records a call and,
    // if the page later overrides the property, the override wins. After boot we
    // assert (a) our spy was never invoked and (b) the property the engine would
    // call now rejects (the page's stub), so no live API remains to prompt.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __midiCalled?: boolean;
        navigator: Navigator & { requestMIDIAccess?: unknown };
      };
      w.__midiCalled = false;
      // A real-looking API the page is expected to replace with a rejecting
      // stub. If it is ever called, the flag trips.
      Object.defineProperty(w.navigator, "requestMIDIAccess", {
        configurable: true,
        value: () => {
          w.__midiCalled = true;
          return Promise.resolve({});
        },
      });
    });

    await start(page, "tavern");

    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        __midiCalled?: boolean;
        navigator: Navigator & { requestMIDIAccess?: () => Promise<unknown> };
      };
      // The page replaced the property with a rejecting stub, so calling it now
      // must reject and must NOT trip the original spy.
      let rejected = false;
      const fn = w.navigator.requestMIDIAccess;
      if (typeof fn === "function") {
        try {
          await fn();
        } catch {
          rejected = true;
        }
      }
      return { called: w.__midiCalled === true, rejected };
    });

    // The real API was never called by the engine, and what remains is the
    // page's rejecting stub — so Chrome had nothing to prompt about.
    expect(result.called).toBe(false);
    expect(result.rejected).toBe(true);
  });
});
