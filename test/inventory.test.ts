// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPack, type PackData } from "../src/model/pack.js";
import { Inventory } from "../src/ui/inventory.js";

// A tiny pack with a couple of items so names resolve.
const pack = loadPack({
  formatVersion: "1.0",
  rooms: {},
  items: [
    { id: 13, chapters: [2], name: "bubble gum" },
    { id: 9, chapters: [2], name: "crucifix" },
    { id: 28, chapters: [1, 2], name: "mobile phone" },
  ],
} as unknown as PackData);

function setup(ids: number[] = [13, 9, 28]) {
  document.body.innerHTML = `<div id="i" role="menu"></div>`;
  const el = document.getElementById("i")!;
  const announce = vi.fn();
  const useOnItem = vi.fn();
  const returnToList = vi.fn();
  const inv = new Inventory(el, pack, {
    announce,
    useOnItem,
    returnToList,
    chapter: () => 2,
  });
  inv.setItems(ids);
  return { el, inv, announce, useOnItem, returnToList };
}

describe("Inventory", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Tab opens a keyboard list of carried items by pack name", () => {
    const { el, inv, announce } = setup();
    inv.openMenu();
    expect(inv.isOpen()).toBe(true);
    const items = el.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("bubble gum");
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining("bubble gum, 1 of 3"),
    );
  });

  it("empty inventory announces and does not open", () => {
    const { inv, announce } = setup([]);
    inv.openMenu();
    expect(inv.isOpen()).toBe(false);
    expect(announce).toHaveBeenCalledWith("Your inventory is empty.");
  });

  it("choosing an item makes it active and announces it", () => {
    const { inv, announce } = setup();
    inv.openMenu();
    inv.chooseCurrent(); // bubble gum active
    expect(inv.activeItemId()).toBe(13);
    expect(announce).toHaveBeenLastCalledWith(
      expect.stringContaining("bubble gum is now active"),
    );
  });

  it("with an item active, choosing another sends use item item2", () => {
    const { inv, useOnItem, returnToList } = setup();
    inv.openMenu();
    inv.chooseCurrent(); // active = bubble gum (13)
    inv.next(); // focus crucifix (9)
    inv.chooseCurrent();
    expect(useOnItem).toHaveBeenCalledWith(13, 9);
    expect(returnToList).toHaveBeenCalled();
    expect(inv.activeItemId()).toBeUndefined();
  });

  it("Backspace clears the active item, then closes on a second press", () => {
    const { inv, announce, returnToList } = setup();
    inv.openMenu();
    inv.chooseCurrent(); // active = bubble gum
    inv.cancel(); // clears active
    expect(inv.activeItemId()).toBeUndefined();
    expect(inv.isOpen()).toBe(true);
    expect(announce).toHaveBeenLastCalledWith("Cleared bubble gum.");
    inv.cancel(); // now closes
    expect(inv.isOpen()).toBe(false);
    expect(returnToList).toHaveBeenCalled();
  });

  it("announces Received X on add and no-longer-have on remove", () => {
    const { inv, announce } = setup();
    inv.announceAdded({ id: 9, name: "CRUZ" });
    expect(announce).toHaveBeenLastCalledWith("Received crucifix.");
    inv.announceRemoved({ id: 13, name: "CHICLE" });
    expect(announce).toHaveBeenLastCalledWith(
      "You no longer have the bubble gum.",
    );
  });
});
