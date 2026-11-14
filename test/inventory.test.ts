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
  const useOnSelf = vi.fn();
  const returnToList = vi.fn();
  const inv = new Inventory(el, pack, {
    announce,
    useOnItem,
    useOnSelf,
    returnToList,
    chapter: () => 2,
  });
  inv.setItems(ids);
  return { el, inv, announce, useOnItem, useOnSelf, returnToList };
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
    // The open line gives the menu name and count only; the item name and its
    // position live on the focused menuitem button (screen-reader-focus R6.1).
    expect(announce).toHaveBeenCalledWith("Inventory, 3 items.");
    expect(announce).not.toHaveBeenCalledWith(
      expect.stringContaining("1 of 3"),
    );
    // Position is exposed via ARIA for the screen reader to read on focus.
    expect(items[0].getAttribute("aria-posinset")).toBe("1");
    expect(items[0].getAttribute("aria-setsize")).toBe("3");
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

  // Tester feedback 14 Nov: the earplugs puzzle needs "use earplugs on yourself"
  // (engine `use 11 50`), which the inventory could not send.
  it("an active item adds a final 'Yourself' entry that uses it on the hero", () => {
    const { el, inv, announce, useOnSelf, useOnItem, returnToList } = setup();
    inv.openMenu();
    inv.chooseCurrent(); // bubble gum (13) active
    const items = el.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(4);
    expect(items[3].textContent).toBe("Yourself");
    inv.next();
    inv.next();
    inv.next(); // onto Yourself
    inv.chooseCurrent();
    expect(useOnSelf).toHaveBeenCalledWith(13);
    expect(useOnItem).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Using bubble gum on yourself.");
    expect(returnToList).toHaveBeenCalled();
  });

  it("no 'Yourself' entry while no item is active", () => {
    const { el, inv } = setup();
    inv.openMenu();
    expect(el.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
  });
});
