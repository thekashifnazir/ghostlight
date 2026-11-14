// @vitest-environment jsdom
//
// screen-reader-focus R6/R7.4: menus speak once, not twice. Each menu writes
// only the menu name and count (or the menu name) to the live region on open,
// and NOTHING on navigation — the roving role=menuitem button carries the item
// name plus aria-posinset/aria-setsize, which a focus-mode screen reader reads
// exactly once. Only action results (item made active, verb chosen, cancel)
// are still announced. This consolidates the "speak once" contract for both
// the inventory and the verb menu in one place.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPack, type PackData } from "../src/model/pack.js";
import { Inventory } from "../src/ui/inventory.js";
import { VerbMenu } from "../src/ui/verb-menu.js";

const pack = loadPack({
  formatVersion: "1.0",
  rooms: {},
  items: [
    { id: 13, chapters: [2], name: "bubble gum" },
    { id: 9, chapters: [2], name: "crucifix" },
  ],
} as unknown as PackData);

function inventory() {
  document.body.innerHTML = `<div id="i" role="menu"></div>`;
  const el = document.getElementById("i")!;
  const announce = vi.fn();
  const inv = new Inventory(el, pack, {
    announce,
    useOnItem: vi.fn(),
    useOnSelf: vi.fn(),
    returnToList: vi.fn(),
    chapter: () => 2,
  });
  inv.setItems([13, 9]);
  return { el, inv, announce };
}

function verbMenu() {
  document.body.innerHTML = `<div id="m" role="menu"></div>`;
  const el = document.getElementById("m")!;
  const announce = vi.fn();
  const menu = new VerbMenu(el, { announce, choose: vi.fn(), returnToList: vi.fn() });
  return { el, menu, announce };
}

describe("menus speak once (screen-reader-focus R6)", () => {
  beforeEach(() => vi.restoreAllMocks());

  describe("inventory", () => {
    it("open line gives the menu name and count, not the focused item name", () => {
      const { inv, announce } = inventory();
      inv.openMenu();
      expect(announce).toHaveBeenCalledWith("Inventory, 2 items.");
      // The item name must NOT be in any live-region line on open.
      for (const call of announce.mock.calls) {
        expect(String(call[0])).not.toContain("bubble gum");
      }
    });

    it("navigation writes nothing to the live region", () => {
      const { inv, announce } = inventory();
      inv.openMenu();
      announce.mockClear();
      inv.next();
      inv.prev();
      expect(announce).not.toHaveBeenCalled();
    });

    it("each menuitem carries aria-posinset/aria-setsize for the reader", () => {
      const { el, inv } = inventory();
      inv.openMenu();
      const items = el.querySelectorAll('[role="menuitem"]');
      expect(items[0].getAttribute("aria-posinset")).toBe("1");
      expect(items[0].getAttribute("aria-setsize")).toBe("2");
      expect(items[1].getAttribute("aria-posinset")).toBe("2");
    });

    it("an action result is still announced as a complete line", () => {
      const { inv, announce } = inventory();
      inv.openMenu();
      announce.mockClear();
      inv.chooseCurrent(); // make bubble gum active
      expect(announce).toHaveBeenLastCalledWith(
        expect.stringContaining("bubble gum is now active"),
      );
    });
  });

  describe("verb menu", () => {
    it("open line gives the menu name only, not the focused verb", () => {
      const { menu, announce } = verbMenu();
      menu.openOn("trunk");
      expect(announce).toHaveBeenLastCalledWith("Actions for trunk.");
      for (const call of announce.mock.calls) {
        expect(String(call[0])).not.toBe("Open");
      }
    });

    it("navigation writes nothing to the live region", () => {
      const { menu, announce } = verbMenu();
      menu.openOn("trunk");
      announce.mockClear();
      menu.next();
      menu.prev();
      expect(announce).not.toHaveBeenCalled();
    });

    it("each menuitem carries aria-posinset/aria-setsize for the reader", () => {
      const { el, menu } = verbMenu();
      menu.openOn("trunk");
      const items = el.querySelectorAll('[role="menuitem"]');
      expect(items).toHaveLength(4);
      expect(items[0].getAttribute("aria-posinset")).toBe("1");
      expect(items[0].getAttribute("aria-setsize")).toBe("4");
    });

    it("an action result (cancel) is still announced", () => {
      const { menu, announce } = verbMenu();
      menu.openOn("trunk");
      announce.mockClear();
      menu.cancel();
      expect(announce).toHaveBeenLastCalledWith("Cancelled. Back to trunk.");
    });
  });
});
