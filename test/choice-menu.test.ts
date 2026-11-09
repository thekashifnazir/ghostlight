// @vitest-environment jsdom
//
// The conversation choice menu (A11Y_CHOICES). Before it existed a blind player
// talking to the drunk in the tavern had NO keyboard way to pick a choice, so
// the engine sat blocked forever. These tests pin the menu's behaviour against
// the one rule that makes it work under VoiceOver with default settings: the
// menu NEVER moves DOM focus. A focused role=option made VoiceOver speak its
// "You are currently on a selectable list item, inside a list box" hint over
// the actors on every arrow press; keeping focus on the game element and
// speaking each option through the live region silences that hint (the same
// path the room list uses, proven on NVDA too). So the container is aria-hidden
// with no role=listbox/option and no "Replies" name, the buttons are never
// focused, the open line reads the first option ("Pick a reply, N options.
// Option 1: <text>"), and each move announces "Option <n> of <N>: <text>".
// The two rules that differ from the verb menu and the inventory still hold:
// Escape does NOT close the menu (the engine is waiting), and number keys / R
// pick directly / repeat the options.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChoiceMenu, type ChoiceOption } from "../src/ui/choice-menu.js";

// The drunk's opening choice menu (engine hotspot 53), numbered 1..3.
const DRUNK: ChoiceOption[] = [
  { n: 1, text: "HI BOSS, HOW ARE YOU?" },
  { n: 2, text: "GIVE ME A DRINK." },
  { n: 3, text: "GOODBYE." },
];

function setup() {
  // A #game element so close()'s guarded returnToList can compare against it.
  document.body.innerHTML = `<div id="game" tabindex="-1"></div><div id="m"></div>`;
  const el = document.getElementById("m")!;
  const announce = vi.fn();
  const choose = vi.fn<(n: number) => void>();
  const returnToList = vi.fn();
  const menu = new ChoiceMenu(el, { announce, choose, returnToList });
  return { el, menu, announce, choose, returnToList };
}

describe("ChoiceMenu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("the container is aria-hidden and is NOT a listbox or named 'Replies'", () => {
    const { el, menu } = setup();
    // aria-hidden so VoiceOver/NVDA never land on an option (the "selectable
    // list item" hint is exactly what talked over the actors).
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("role")).toBeNull();
    expect(el.getAttribute("aria-label")).toBeNull();
    menu.openWith(DRUNK);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    // No listbox/option (or menu/menuitem) roles anywhere.
    expect(
      el.querySelectorAll(
        '[role="listbox"], [role="option"], [role="menu"], [role="menuitem"]',
      ),
    ).toHaveLength(0);
  });

  it("opens hidden, then shows the visual buttons without moving focus", () => {
    const { el, menu } = setup();
    expect(el.hidden).toBe(true);
    menu.openWith(DRUNK);
    expect(menu.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    const items = el.querySelectorAll("button");
    expect(items).toHaveLength(3);
    // Focus NEVER moves to an option: it stays where it was (the body here, a
    // stand-in for #game in the real page). No button is tab-focusable either.
    expect(document.activeElement).not.toBe(items[0]);
    for (const b of Array.from(items)) {
      expect((b as HTMLElement).tabIndex).toBe(-1);
    }
    // The option text is on the button for sighted players and mouse clicks.
    expect(items[0].textContent).toBe("HI BOSS, HOW ARE YOU?");
    // The current option is marked visually only (a CSS class, no ARIA).
    expect(items[0].classList.contains("current")).toBe(true);
    expect(items[1].classList.contains("current")).toBe(false);
  });

  it("opens with one line: the prompt, the count, and the first option", () => {
    const { menu, announce } = setup();
    menu.openWith(DRUNK);
    // One coherent live-region line carries the first option through the live
    // region (not a focused widget), so there is no double-speak.
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(
      "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU?",
    );
  });

  it("uses the singular 'option' for a single choice", () => {
    const { menu, announce } = setup();
    menu.openWith([{ n: 1, text: "GOODBYE." }]);
    expect(announce).toHaveBeenLastCalledWith(
      "Pick a reply, 1 option. Option 1: GOODBYE.",
    );
  });

  it("the open line reads a used first option as 'already asked'", () => {
    const { menu, announce } = setup();
    menu.openWith([
      { n: 1, text: "HI BOSS, HOW ARE YOU?", used: true },
      { n: 2, text: "GIVE ME A DRINK." },
    ]);
    expect(announce).toHaveBeenLastCalledWith(
      "Pick a reply, 2 options. Option 1, already asked: HI BOSS, HOW ARE YOU?",
    );
  });

  it("navigation announces 'Option n of N: text' and never moves focus", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    const before = document.activeElement;
    announce.mockClear();
    const items = el.querySelectorAll("button");

    menu.next(); // -> option 2
    expect(announce).toHaveBeenLastCalledWith(
      "Option 2 of 3: GIVE ME A DRINK.",
    );
    // The visual highlight follows the index; DOM focus does not move.
    expect(items[1].classList.contains("current")).toBe(true);
    expect(items[0].classList.contains("current")).toBe(false);
    expect(document.activeElement).toBe(before);

    menu.next(); // -> option 3
    expect(announce).toHaveBeenLastCalledWith("Option 3 of 3: GOODBYE.");
    menu.next(); // wraps -> option 1
    expect(announce).toHaveBeenLastCalledWith(
      "Option 1 of 3: HI BOSS, HOW ARE YOU?",
    );
    menu.prev(); // wraps back -> option 3
    expect(announce).toHaveBeenLastCalledWith("Option 3 of 3: GOODBYE.");
    expect(document.activeElement).toBe(before);
  });

  it("next() announces 'Option 2 of 4: ...' and does not change the active element", () => {
    const { el, menu, announce } = setup();
    const four: ChoiceOption[] = [
      { n: 1, text: "HI BOSS, HOW ARE YOU?" },
      { n: 2, text: "AND HOW IS THE FAMILY?" },
      { n: 3, text: "GIVE ME A DRINK." },
      { n: 4, text: "GOODBYE." },
    ];
    menu.openWith(four);
    const activeBefore = document.activeElement;
    announce.mockClear();
    menu.next();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      "Option 2 of 4: AND HOW IS THE FAMILY?",
    );
    // The crux of the fix: no focus move on a move.
    expect(document.activeElement).toBe(activeBefore);
    expect(el.querySelectorAll("button")[1].classList.contains("current")).toBe(
      true,
    );
  });

  it("navigation reads a used option as 'already asked'", () => {
    const { menu, announce } = setup();
    menu.openWith([
      { n: 1, text: "HI BOSS, HOW ARE YOU?" },
      { n: 2, text: "GIVE ME A DRINK.", used: true },
    ]);
    announce.mockClear();
    menu.next(); // -> option 2 (used)
    expect(announce).toHaveBeenLastCalledWith(
      "Option 2 of 2, already asked: GIVE ME A DRINK.",
    );
  });

  it("Enter picks the current option's engine number and enters the waiting state without moving focus", () => {
    const { el, menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    const activeBefore = document.activeElement;
    menu.next(); // current option 2 (GIVE ME A DRINK, engine n=2)
    menu.chooseCurrent();
    expect(choose).toHaveBeenCalledWith(2);
    // The menu does NOT move focus. It stays open, enters the waiting state,
    // and marks the container aria-busy until the engine's next choices (or the
    // end) arrive.
    expect(returnToList).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(activeBefore);
    expect(menu.isOpen()).toBe(true);
    expect(menu.isWaiting()).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.hidden).toBe(false);
  });

  it("a number key picks that option directly, entering the waiting state", () => {
    const { menu, choose, returnToList } = setup();
    menu.openWith(DRUNK);
    // The current option is 1, but pressing 3 picks option 3.
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
    const activeWhileWaiting = document.activeElement;
    announce.mockClear();
    // Every pick/nav key is a silent no-op while the engine processes the pick.
    menu.next();
    menu.prev();
    menu.chooseCurrent();
    menu.chooseNumber(2);
    expect(choose).toHaveBeenCalledTimes(1); // still just the first pick
    expect(announce).not.toHaveBeenCalled(); // no speech
    // Focus does not move (it never did).
    expect(document.activeElement).toBe(activeWhileWaiting);
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

  it("plays two rounds without ever moving focus, and closes once at the end", () => {
    const { el, menu, choose, returnToList } = setup();
    const activeStart = document.activeElement;
    // Round 1: open and pick. Focus never moves to an option.
    menu.openWith(DRUNK);
    expect(document.activeElement).toBe(activeStart);
    menu.chooseCurrent();
    expect(menu.isWaiting()).toBe(true);
    expect(document.activeElement).toBe(activeStart);
    expect(returnToList).not.toHaveBeenCalled();

    // Round 2: the engine offers a follow-up question. openWith replaces the
    // options in place, clears the waiting/busy state, resets to option 1, and
    // announces the open line, still without moving focus.
    const followUp: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    menu.openWith(followUp);
    expect(menu.isWaiting()).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(activeStart);
    expect(returnToList).not.toHaveBeenCalled();

    // Pick again -> waiting, then the conversation ends (control phase) and the
    // page closes the menu.
    menu.chooseCurrent();
    expect(returnToList).not.toHaveBeenCalled();
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
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
    expect(menu.isOpen()).toBe(true); // still open, the engine is waiting
    expect(choose).not.toHaveBeenCalled();
    expect(announce).toHaveBeenLastCalledWith(
      "Pick an option with Up and Down, then Enter.",
    );
  });

  it("a fresh set of choices replaces the open menu (a follow-up question) without moving focus", () => {
    const { el, menu, announce } = setup();
    const activeStart = document.activeElement;
    menu.openWith(DRUNK);
    const followUp: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    announce.mockClear();
    menu.openWith(followUp);
    const items = el.querySelectorAll("button");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("YES.");
    expect(document.activeElement).toBe(activeStart);
    expect(announce).toHaveBeenLastCalledWith(
      "Pick a reply, 2 options. Option 1: YES.",
    );
  });

  it("close() hides the menu and clears it, without choosing", () => {
    const { el, menu, choose } = setup();
    menu.openWith(DRUNK);
    menu.close();
    expect(menu.isOpen()).toBe(false);
    expect(el.hidden).toBe(true);
    expect(el.querySelectorAll("button")).toHaveLength(0);
    expect(choose).not.toHaveBeenCalled();
  });

  it("close() calls returnToList only when focus is NOT already on the game element", () => {
    // Focus never moved off #game while the menu was open, so close() is a
    // no-op for focus. The guard only fires returnToList as a safety net when
    // something else holds focus.
    const { menu, returnToList } = setup();
    const game = document.getElementById("game")!;

    // Case 1: focus is already on #game -> no returnToList call.
    game.focus();
    menu.openWith(DRUNK);
    menu.close();
    expect(returnToList).not.toHaveBeenCalled();

    // Case 2: some other element holds focus -> returnToList fires as the
    // safety net so a hidden button can never keep focus.
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    menu.openWith(DRUNK);
    menu.close();
    expect(returnToList).toHaveBeenCalledTimes(1);
  });

  it("re-offering the SAME set after a pick updates in place: keeps the index, clears aria-busy, and announces nothing", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    // Move to option 2, then pick it -> waiting + aria-busy.
    menu.next();
    const items = el.querySelectorAll("button");
    expect(items[1].classList.contains("current")).toBe(true);
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

    // In place: NOT rebuilt. The exact same button elements remain, and the
    // index is unchanged (still option 2, still the current highlight).
    const itemsAfter = el.querySelectorAll("button");
    expect(itemsAfter).toHaveLength(3);
    expect(itemsAfter[0]).toBe(items[0]);
    expect(itemsAfter[1]).toBe(items[1]);
    expect(itemsAfter[2]).toBe(items[2]);
    expect(items[1].classList.contains("current")).toBe(true);
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

  it("a DIFFERENT set still rebuilds, resets to option 1, and announces the open line", () => {
    const { el, menu, announce } = setup();
    menu.openWith(DRUNK);
    menu.next(); // move off option 1 so a reset is observable
    expect(el.querySelectorAll("button")[1].classList.contains("current")).toBe(
      true,
    );
    announce.mockClear();

    // A genuinely new question: different count and text.
    const newSet: ChoiceOption[] = [
      { n: 1, text: "YES." },
      { n: 2, text: "NO." },
    ];
    menu.openWith(newSet);
    const items = el.querySelectorAll("button");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe("YES.");
    // Reset to option 1 (the current highlight) and announced.
    expect(items[0].classList.contains("current")).toBe(true);
    expect(announce).toHaveBeenCalledWith("Pick a reply, 2 options. Option 1: YES.");
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
    const items = el.querySelectorAll("button");
    expect(items[0].textContent).toBe("TELL ME ABOUT THE CASTLE.");
    expect(items[0].classList.contains("current")).toBe(true);
    expect(announce).toHaveBeenCalledWith(
      "Pick a reply, 3 options. Option 1: TELL ME ABOUT THE CASTLE.",
    );
  });

  it("renders a visually hidden 'already asked' marker on used options, and R reads it", () => {
    const { el, menu, announce } = setup();
    menu.openWith([
      { n: 1, text: "HI BOSS, HOW ARE YOU?", used: true },
      { n: 2, text: "GIVE ME A DRINK." },
      { n: 3, text: "GOODBYE." },
    ]);
    const items = el.querySelectorAll("button");
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
