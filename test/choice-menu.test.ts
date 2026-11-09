// @vitest-environment jsdom
//
// The conversation choice menu (A11Y_CHOICES). Before it existed a blind player
// talking to the drunk in the tavern had NO keyboard way to pick a choice, so
// the engine sat blocked forever. These tests pin the menu's behaviour against
// the screen-reader-focus rules (role=listbox/option with aria-posinset/
// aria-setsize and aria-selected on the focused option, the open line is the
// menu name and count only, navigation is silent in the live region) and the
// two rules that differ from the verb menu and the inventory: Escape does NOT
// close the menu (the engine is waiting), and number keys / R pick directly /
// repeat the options. The listbox role (not role=menu) is deliberate: it stops
// VoiceOver adding its wrong "Control-Option-Space to choose, Escape to close"
// menu hint.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceMenu, type ChoiceOption } from "../src/ui/choice-menu.js";

// The drunk's opening choice menu (engine hotspot 53), numbered 1..3.
const DRUNK: ChoiceOption[] = [
  { n: 1, text: "HI BOSS, HOW ARE YOU?" },
  { n: 2, text: "GIVE ME A DRINK." },
  { n: 3, text: "GOODBYE." },
];

function setup() {
  document.body.innerHTML = `<div id="m"></div>`;
  const el = document.getElementById("m")!;
  const announce = vi.fn();
  const choose = vi.fn<(n: number) => void>();
  const returnToList = vi.fn();
  const menu = new ChoiceMenu(el, { announce, choose, returnToList });
  return { el, menu, announce, choose, returnToList };
}

describe("ChoiceMenu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("the container is a listbox named Choices, not a role=menu", () => {
    const { el, menu } = setup();
    // The listbox role (not role=menu) stops VoiceOver adding its menu hint.
    expect(el.getAttribute("role")).toBe("listbox");
    expect(el.getAttribute("aria-label")).toBe("Choices");
    menu.openWith(DRUNK);
    expect(el.getAttribute("role")).toBe("listbox");
    // No menu/menuitem roles anywhere — those are what trigger the wrong hint.
    expect(el.querySelectorAll('[role="menu"], [role="menuitem"]')).toHaveLength(
      0,
    );
  });

  it("opens hidden, then shows roving-focus options with option 1 focused and selected", () => {
    const { el, menu } = setup();
    expect(el.hidden).toBe(true);
    menu.openWith(DRUNK);
    expect(menu.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    const items = el.querySelectorAll('[role="option"]');
    expect(items).toHaveLength(3);
    // Roving focus: exactly one tabbable, option 1 focused.
    const tabbable = Array.from(items).filter(
      (b) => (b as HTMLElement).tabIndex === 0,
    );
    expect(tabbable).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);
    // The option text is on the button, read by the screen reader on focus.
    expect(items[0].textContent).toBe("HI BOSS, HOW ARE YOU?");
    // Each option exposes its position/size for the reader (R6.3).
    expect(items[0].getAttribute("aria-posinset")).toBe("1");
    expect(items[0].getAttribute("aria-setsize")).toBe("3");
    // aria-selected marks the focused option (1) and only it.
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[1].getAttribute("aria-selected")).toBe("false");
    expect(items[2].getAttribute("aria-selected")).toBe("false");
    expect(items[2].getAttribute("aria-posinset")).toBe("3");
  });

  it("opens with the menu name and count only; the option text is not repeated in the live region", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    // The open line gives the menu name and count only; the focused option 1
    // button carries its text, read once by the screen reader (R6.1).
    expect(announce).toHaveBeenLastCalledWith("Choices, 3 options.");
    for (const call of announce.mock.calls) {
      expect(String(call[0])).not.toContain("HI BOSS");
    }
  });

  it("uses the singular 'option' for a single choice", () => {
    const { menu, announce } = setup();
    menu.openWith([{ n: 1, text: "GOODBYE." }]);
    expect(announce).toHaveBeenLastCalledWith("Choices, 1 option.");
  });

  it("navigation moves roving focus (and aria-selected) but writes nothing to the live region", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    announce.mockClear();
    const items = el.querySelectorAll('[role="option"]');
    menu.next(); // -> option 2
    expect(document.activeElement).toBe(items[1]);
    // aria-selected follows roving focus: only option 2 is selected now.
    expect(items[1].getAttribute("aria-selected")).toBe("true");
    expect(items[0].getAttribute("aria-selected")).toBe("false");
    menu.next(); // -> option 3
    expect(document.activeElement).toBe(items[2]);
    menu.next(); // wraps -> option 1
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    menu.prev(); // wraps back -> option 3
    expect(document.activeElement).toBe(items[2]);
    expect(items[2].getAttribute("aria-selected")).toBe("true");
    expect(announce).not.toHaveBeenCalled();
  });

  it("Enter picks the focused option's engine number and returns focus", () => {
    const { menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    menu.next(); // focus option 2 (GIVE ME A DRINK, engine n=2)
    menu.chooseCurrent();
    expect(choose).toHaveBeenCalledWith(2);
    expect(returnToList).toHaveBeenCalled();
    expect(menu.isOpen()).toBe(false);
  });

  it("a number key picks that option directly, regardless of focus", () => {
    const { menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    // Focus is on option 1, but pressing 3 picks option 3.
    menu.chooseNumber(3);
    expect(choose).toHaveBeenCalledWith(3);
    expect(returnToList).toHaveBeenCalled();
    expect(menu.isOpen()).toBe(false);
  });

  it("ignores an out-of-range number key (menu stays open, nothing chosen)", () => {
    const { menu, choose } = setup();
    menu.openWith(DRUNK);
    menu.chooseNumber(7); // only 1..3 exist
    expect(choose).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    menu.chooseNumber(0);
    expect(choose).not.toHaveBeenCalled();
  });

  it("R repeats all the options as one line", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    announce.mockClear();
    menu.repeatAll();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "1. HI BOSS, HOW ARE YOU? 2. GIVE ME A DRINK. 3. GOODBYE.",
    );
  });

  it("Escape does not close the menu; it re-states how to choose", () => {
    const { menu, announce, choose } = setup();
    menu.openWith(DRUNK);
    announce.mockClear();
    menu.explainNoEscape();
    expect(menu.isOpen()).toBe(true); // still open — the engine is waiting
    expect(choose).not.toHaveBeenCalled();
    expect(announce).toHaveBeenLastCalledWith(
      "Pick an option with Up and Down, then Enter.",
    );
  });

  it("a fresh set of choices replaces the open menu (a follow-up question)", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    const followUp: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    announce.mockClear();
    menu.openWith(followUp);
    const items = el.querySelectorAll('[role="option"]');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("YES.");
    expect(document.activeElement).toBe(items[0]);
    expect(announce).toHaveBeenLastCalledWith("Choices, 2 options.");
  });

  it("close() hides the menu and clears it, without choosing", () => {
    const { el, menu, choose } = setup();
    menu.openWith(DRUNK);
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(el.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(choose).not.toHaveBeenCalled();
  });

  it("ignores key methods while closed", () => {
    const { menu, announce, choose } = setup();
    // Never opened.
    menu.next();
    menu.prev();
    menu.chooseCurrent();
    menu.chooseNumber(1);
    menu.repeatAll();
    menu.explainNoEscape();
    expect(announce).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
  });
});
