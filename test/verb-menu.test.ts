// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VerbMenu } from "../src/ui/verb-menu.js";

function setup() {
  document.body.innerHTML = `<div id="m" role="menu"></div>`;
  const el = document.getElementById("m")!;
  const announce = vi.fn();
  const choose = vi.fn();
  const returnToList = vi.fn();
  const menu = new VerbMenu(el, { announce, choose, returnToList });
  return { el, menu, announce, choose, returnToList };
}

describe("VerbMenu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens with four roving-focus menuitems, first focused", () => {
    const { el, menu } = setup();
    menu.openOn("bartender");
    expect(menu.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    const items = el.querySelectorAll('[role="menuitem"]');
    expect(items).toHaveLength(4);
    // Roving focus: exactly one tabbable.
    const tabbable = Array.from(items).filter(
      (b) => (b as HTMLElement).tabIndex === 0,
    );
    expect(tabbable).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);
  });

  it("announces each option as focus moves and wraps", () => {
    const { menu, announce } = setup();
    menu.openOn("door");
    announce.mockClear();
    menu.next(); // Close
    expect(announce).toHaveBeenLastCalledWith("Close");
    menu.next(); // Talk to
    menu.next(); // Push
    menu.next(); // wrap to Open
    expect(announce).toHaveBeenLastCalledWith("Open");
  });

  it("choosing a verb sends it and returns focus to the list", () => {
    const { menu, choose, returnToList } = setup();
    menu.openOn("door");
    menu.next(); // focus Close
    menu.chooseCurrent();
    expect(choose).toHaveBeenCalledWith("close");
    expect(returnToList).toHaveBeenCalled();
    expect(menu.isOpen()).toBe(false);
  });

  it("cancel closes, announces the return, and returns focus", () => {
    const { menu, announce, returnToList, choose } = setup();
    menu.openOn("skull");
    menu.cancel();
    expect(menu.isOpen()).toBe(false);
    expect(choose).not.toHaveBeenCalled();
    expect(returnToList).toHaveBeenCalled();
    expect(announce).toHaveBeenLastCalledWith("Cancelled. Back to skull.");
  });
});
