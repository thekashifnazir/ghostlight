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

  it("the container is a listbox named Replies, not a role=menu", () => {
    const { el, menu } = setup();
    // The listbox role (not role=menu) stops VoiceOver adding its menu hint.
    expect(el.getAttribute("role")).toBe("listbox");
    expect(el.getAttribute("aria-label")).toBe("Replies");
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

  it("opens with the prompt and count only; the option text is not repeated in the live region", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    // The open line gives the prompt and count only; the focused option 1
    // button carries its text, read once by the screen reader (R6.1).
    expect(announce).toHaveBeenLastCalledWith("Pick a reply, 3 options.");
    for (const call of announce.mock.calls) {
      expect(String(call[0])).not.toContain("HI BOSS");
    }
  });

  it("uses the singular 'option' for a single choice", () => {
    const { menu, announce } = setup();
    menu.openWith([{ n: 1, text: "GOODBYE." }]);
    expect(announce).toHaveBeenLastCalledWith("Pick a reply, 1 option.");
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

  it("Enter picks the focused option's engine number and enters the waiting state without returning focus", () => {
    const { el, menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    menu.next(); // focus option 2 (GIVE ME A DRINK, engine n=2)
    menu.chooseCurrent();
    expect(choose).toHaveBeenCalledWith(2);
    // Fix 1: within one conversation the menu KEEPS focus and does NOT bounce
    // back to #game. It stays open, enters the waiting state, and marks the
    // listbox aria-busy until the engine's next choices (or the end) arrive.
    expect(returnToList).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    expect(menu.isWaiting()).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.hidden).toBe(false);
  });

  it("a number key picks that option directly, entering the waiting state", () => {
    const { menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    // Focus is on option 1, but pressing 3 picks option 3.
    menu.chooseNumber(3);
    expect(choose).toHaveBeenCalledWith(3);
    expect(returnToList).not.toHaveBeenCalled();
    expect(menu.isOpen()).toBe(true);
    expect(menu.isWaiting()).toBe(true);
  });

  it("while waiting, Enter, the arrows and number keys are ignored with no speech or pick", () => {
    const { el, menu, choose, announce } = setup();
    menu.openWith(DRUNK);
    menu.chooseCurrent(); // pick option 1 -> waiting
    expect(choose).toHaveBeenCalledTimes(1);
    const focusedWhileWaiting = document.activeElement;
    announce.mockClear();
    // Every pick/nav key is a silent no-op while the engine processes the pick.
    menu.next();
    menu.prev();
    menu.chooseCurrent();
    menu.chooseNumber(2);
    expect(choose).toHaveBeenCalledTimes(1); // still just the first pick
    expect(announce).not.toHaveBeenCalled(); // no speech
    // Focus stays put inside the listbox (never bounced to #game).
    expect(document.activeElement).toBe(focusedWhileWaiting);
    expect(el.getAttribute("aria-busy")).toBe("true");
  });

  it("while waiting, R still re-reads the options", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    menu.chooseCurrent(); // -> waiting
    announce.mockClear();
    menu.repeatAll();
    expect(announce).toHaveBeenCalledWith(
      "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU? Option 2: GIVE ME A DRINK. Option 3: GOODBYE.",
    );
  });

  it("keeps focus in the menu across two rounds and returns to #game once at the end", () => {
    const { el, menu, choose, returnToList } = setup();
    // Round 1: open and pick. Focus stays in the listbox; no return to #game.
    menu.openWith(DRUNK);
    const firstFocus = document.activeElement;
    expect(el.contains(firstFocus)).toBe(true);
    menu.chooseCurrent();
    expect(menu.isWaiting()).toBe(true);
    expect(el.contains(document.activeElement)).toBe(true); // still in the menu
    expect(returnToList).not.toHaveBeenCalled();

    // Round 2: the engine offers a follow-up question. openWith replaces the
    // options in place, clears the waiting/busy state, and focuses option 1 —
    // without the menu ever losing focus to #game.
    const followUp: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    menu.openWith(followUp);
    expect(menu.isWaiting()).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
    const items = el.querySelectorAll('[role="option"]');
    expect(document.activeElement).toBe(items[0]);
    expect(returnToList).not.toHaveBeenCalled(); // STILL no bounce between rounds

    // Pick again -> waiting, then the conversation ends (control phase) and the
    // page closes the menu, which returns focus to #game EXACTLY once.
    menu.chooseCurrent();
    expect(returnToList).not.toHaveBeenCalled();
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(returnToList).toHaveBeenCalledTimes(1);
    // Picks sent: one per round.
    expect(choose).toHaveBeenCalledTimes(2);
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

  it("R repeats all the options, each prefixed 'Option n:', with the prompt header and full stops", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    announce.mockClear();
    menu.repeatAll();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU? Option 2: GIVE ME A DRINK. Option 3: GOODBYE.",
    );
  });

  it("adds a full stop to an option that has no ending punctuation, keeping the engine's text", () => {
    const { menu, announce } = setup();
    // Two options without terminal punctuation, one with a question mark.
    menu.openWith([
      { n: 1, text: "Hi boss, how are you?" },
      { n: 2, text: "This is quite groovy, huh" },
      { n: 3, text: "I'd better not say anything" },
    ]);
    announce.mockClear();
    menu.repeatAll();
    expect(announce).toHaveBeenCalledWith(
      "Pick a reply, 3 options. Option 1: Hi boss, how are you? " +
        "Option 2: This is quite groovy, huh. Option 3: I'd better not say anything.",
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
    expect(announce).toHaveBeenLastCalledWith("Pick a reply, 2 options.");
  });

  it("close() hides the menu, clears it, and returns focus to #game once, without choosing", () => {
    const { el, menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(el.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(choose).not.toHaveBeenCalled();
    // Closing at the end of the conversation hands focus back to #game once, so
    // focus never stays trapped on a now-hidden listbox option (Fix 1).
    expect(returnToList).toHaveBeenCalledTimes(1);
  });

  it("re-offering the SAME set after a pick updates in place: keeps the index and the focused element, clears aria-busy, and announces nothing", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    // Move to option 2, then pick it -> waiting + aria-busy.
    menu.next();
    const items = el.querySelectorAll('[role="option"]');
    const focusedBeforePick = document.activeElement;
    expect(focusedBeforePick).toBe(items[1]);
    menu.chooseCurrent();
    expect(menu.isWaiting()).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");

    announce.mockClear();
    // The engine re-offers the SAME options (same n+text, same order), only
    // now option 2 carries used: true.
    const sameSet: ChoiceOption[] = [
      { n: 1, text: "HI BOSS, HOW ARE YOU?" },
      { n: 2, text: "GIVE ME A DRINK.", used: true },
      { n: 3, text: "GOODBYE." },
    ];
    menu.openWith(sameSet);

    // In place: NOT rebuilt. The exact same button elements remain, the index
    // is unchanged (still option 2), and the focused DOM element is untouched.
    const itemsAfter = el.querySelectorAll('[role="option"]');
    expect(itemsAfter).toHaveLength(3);
    expect(itemsAfter[0]).toBe(items[0]);
    expect(itemsAfter[1]).toBe(items[1]);
    expect(itemsAfter[2]).toBe(items[2]);
    expect(document.activeElement).toBe(focusedBeforePick);
    // Waiting and aria-busy cleared so the menu is pickable again.
    expect(menu.isWaiting()).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
    // No announcement at all (it must not talk over the actors).
    expect(announce).not.toHaveBeenCalled();
    // The used marker now renders on option 2.
    expect(items[1].querySelector(".visually-hidden")?.textContent).toBe(
      ", already asked",
    );
    expect(items[0].querySelector(".visually-hidden")).toBeNull();
  });

  it("a DIFFERENT set still rebuilds, resets to option 1, and announces the prompt", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    menu.next(); // move off option 1 so a reset is observable
    expect(document.activeElement).toBe(
      el.querySelectorAll('[role="option"]')[1],
    );
    announce.mockClear();

    // A genuinely new question: different count and text.
    const newSet: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    menu.openWith(newSet);
    const items = el.querySelectorAll('[role="option"]');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("YES.");
    // Reset to option 1 and announced.
    expect(document.activeElement).toBe(items[0]);
    expect(announce).toHaveBeenCalledWith("Pick a reply, 2 options.");
  });

  it("a same-count set with different text rebuilds and announces (not treated as the same set)", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    announce.mockClear();
    // Same count (3), but the text differs: this is a new question.
    const differentText: ChoiceOption[] = [
      { n: 1, text: "TELL ME ABOUT THE CASTLE." },
      { n: 2, text: "WHO ARE YOU?" },
      { n: 3, text: "GOODBYE." },
    ];
    menu.openWith(differentText);
    const items = el.querySelectorAll('[role="option"]');
    expect(items[0].textContent).toBe("TELL ME ABOUT THE CASTLE.");
    expect(document.activeElement).toBe(items[0]);
    expect(announce).toHaveBeenCalledWith("Pick a reply, 3 options.");
  });

  it("renders a visually hidden 'already asked' marker on used options, and R reads it", () => {
    const { el, menu, announce } = setup();
    menu.openWith([
      { n: 1, text: "HI BOSS, HOW ARE YOU?", used: true },
      { n: 2, text: "GIVE ME A DRINK." },
      { n: 3, text: "GOODBYE." },
    ]);
    const items = el.querySelectorAll('[role="option"]');
    // Option 1 is used: a .visually-hidden marker, engine text kept verbatim.
    const marker = items[0].querySelector(".visually-hidden");
    expect(marker?.textContent).toBe(", already asked");
    expect(items[0].firstChild?.textContent).toBe("HI BOSS, HOW ARE YOU?");
    // The unused options have no marker.
    expect(items[1].querySelector(".visually-hidden")).toBeNull();
    expect(items[2].querySelector(".visually-hidden")).toBeNull();

    // R reads a used option as "Option n, already asked: <text>".
    announce.mockClear();
    menu.repeatAll();
    expect(announce).toHaveBeenCalledWith(
      "Pick a reply, 3 options. Option 1, already asked: HI BOSS, HOW ARE YOU? " +
        "Option 2: GIVE ME A DRINK. Option 3: GOODBYE.",
    );
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
