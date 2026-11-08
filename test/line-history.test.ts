// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { EngineAdapter } from "../src/engine/adapter.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { Pack } from "../src/model/pack.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { Controller } from "../src/ui/controller.js";
import { LiveRegion } from "../src/ui/live-region.js";

// R repeats the last line; Shift+R steps back through up to 20 earlier lines,
// announcing "Earlier: <line>"; any other key resets the back cursor. These
// drive the REAL Controller against the REAL LiveRegion, exactly as main.ts
// wires them (controller.handleKey(key, shiftKey)), so the keyboard routing and
// the history are pinned together.

function harness() {
  document.body.innerHTML = `<div id="log" role="log"></div>`;
  const region = document.getElementById("log")!;
  const live = new LiveRegion(region);

  const controller = new Controller({
    adapter: { send: () => {} } as unknown as EngineAdapter,
    pack: {} as unknown as Pack,
    currentRoom: () => 62,
    // A non-empty list so arrow keys announce a focus line (a "new" line that
    // must reset the back cursor). current() is never used by these tests.
    list: {
      current: () => undefined,
      next: () => live.announce("skull, 2 of 2"),
      prev: () => live.announce("bottle, 1 of 2"),
      announceCurrent: () => {},
    } as unknown as ListMode,
    verbMenu: { isOpen: () => false } as unknown as VerbMenu,
    inventory: {
      isOpen: () => false,
      activeItemId: () => null,
    } as unknown as Inventory,
    live,
    showHighlight: () => {},
    readRoom: () => {},
    readHelp: () => {},
    stopAudio: () => {},
    askHint: () => {},
    toggleGhostVoice: () => {},
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  const region2 = region;
  return { controller, live, region: region2 };
}

describe("line history via the keyboard", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
    h.live.announce("First.");
    h.live.announce("Second.");
    h.live.announce("Third."); // current line
  });

  it("R repeats the last line", () => {
    h.region.textContent = ""; // simulate the region read and cleared
    h.controller.handleKey("r");
    expect(h.region.textContent).toBe("Third.");
  });

  it("Shift+R steps back through earlier lines as 'Earlier: <line>'", () => {
    h.controller.handleKey("R", true);
    expect(h.region.textContent).toBe("Earlier: Second.");
    h.controller.handleKey("R", true);
    expect(h.region.textContent).toBe("Earlier: First.");
  });

  it("R without shift repeats even after stepping back (last line intact)", () => {
    h.controller.handleKey("R", true); // "Earlier: Second."
    h.controller.handleKey("r"); // repeat the real last line
    expect(h.region.textContent).toBe("Third.");
  });

  it("any other key resets the back cursor", () => {
    h.controller.handleKey("R", true); // "Earlier: Second."
    h.controller.handleKey("R", true); // "Earlier: First."
    expect(h.region.textContent).toBe("Earlier: First.");

    // A non-Shift+R key (here L, read room is a no-op announce in this harness)
    // resets the cursor. Use ArrowRight, which announces a new focus line.
    h.controller.handleKey("ArrowRight");
    expect(h.region.textContent).toBe("skull, 2 of 2");

    // The announced focus line is now the current line, and its predecessor is
    // "Third."; a fresh Shift+R starts from the most recent earlier line.
    h.controller.handleKey("R", true);
    expect(h.region.textContent).toBe("Earlier: Third.");
  });

  it("Shift+R never routes the plain repeat key by accident", () => {
    // Uppercase "R" WITHOUT shift (Caps Lock) is still a plain repeat, not a
    // step back — the modifier, not the case, decides.
    h.region.textContent = "";
    h.controller.handleKey("R", false);
    expect(h.region.textContent).toBe("Third.");
  });
});
