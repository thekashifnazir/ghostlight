// @vitest-environment jsdom
//
// Controller routing for the conversation choice menu. These tests drive the
// Controller the way the page does — one key at a time through handleKey — with
// a REAL ChoiceMenu (jsdom) whose `choose` callback sends `{ verb: 'choose', n }`
// through a fake adapter, exactly as main.ts wires it. They prove that while the
// menu is open the controller hands every relevant key to it (and consumes it,
// so none reaches the engine's own input), that a pick sends the right choose
// command, and that the menu takes priority over list mode.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, EngineAdapter } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import type { Pack } from "../src/model/pack.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { ChoiceMenu, type ChoiceOption } from "../src/ui/choice-menu.js";
import { Controller } from "../src/ui/controller.js";

const DRUNK: ChoiceOption[] = [
  { n: 1, text: "HI BOSS, HOW ARE YOU?" },
  { n: 2, text: "GIVE ME A DRINK." },
  { n: 3, text: "GOODBYE." },
];

/** A focused list hotspot, so list-mode keys have something to act on. */
const FOCUSED: Hotspot = {
  num: 53,
  kind: "npc",
  name: "drunk",
  rect: [277, 93, 36, 67],
  walkTo: [285, 160],
};

function harness() {
  document.body.innerHTML = `<div id="m"></div>`;
  const el = document.getElementById("m")!;

  const sent: Command[] = [];
  const adapter = {
    send: (cmd: Command) => void sent.push(cmd),
    start: () => Promise.resolve(),
    onEvent: () => () => {},
  } as unknown as EngineAdapter;

  const lines: string[] = [];

  const returnToList = vi.fn();
  const choiceMenu = new ChoiceMenu(el, {
    announce: (t) => lines.push(t),
    choose: (n) => adapter.send({ verb: "choose", n }),
    returnToList,
  });

  // A list stub that records navigation, so we can prove a key reaches list
  // mode only when the choice menu is closed.
  const listCalls: string[] = [];
  const list = {
    current: () => FOCUSED,
    next: () => void listCalls.push("next"),
    prev: () => void listCalls.push("prev"),
    announceCurrent: () => void listCalls.push("announceCurrent"),
  } as unknown as ListMode;

  const stopAudio = vi.fn();
  const readRoom = vi.fn();
  const askHint = vi.fn();
  const repeat = vi.fn();
  // The live region the controller sees also exposes repeat() (used by R when
  // the phase has moved on) and resetHistoryCursor() (called on every key).
  const live2 = {
    announce: (t: string) => void lines.push(t),
    repeat,
    resetHistoryCursor: () => {},
  } as unknown as LiveRegion;

  // A mutable engine phase the test drives, read through the deps accessor.
  let phase: "control" | "busy" | "choice" | undefined;
  const setPhase = (p: typeof phase) => {
    phase = p;
  };

  const controller = new Controller({
    adapter,
    pack: {} as unknown as Pack,
    currentRoom: () => 62,
    list,
    verbMenu: { isOpen: () => false } as unknown as VerbMenu,
    inventory: {
      isOpen: () => false,
      activeItemId: () => null,
    } as unknown as Inventory,
    choiceMenu,
    enginePhase: () => phase,
    live: live2,
    showHighlight: () => {},
    readRoom,
    readHelp: () => {},
    stopAudio,
    askHint,
    toggleGhostVoice: () => {},
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  return {
    controller,
    choiceMenu,
    adapter,
    sent,
    lines,
    listCalls,
    returnToList,
    stopAudio,
    readRoom,
    askHint,
    repeat,
    setPhase,
  };
}

describe("Controller routing: conversation choice menu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("routes arrows to the menu and consumes them (none reach list mode)", () => {
    const { controller, choiceMenu, listCalls } = harness();
    choiceMenu.openWith(DRUNK);
    const items = document.querySelectorAll('[role="option"]');

    expect(controller.handleKey("ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    expect(controller.handleKey("ArrowUp")).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    // List navigation was never touched while the menu owned the keyboard.
    expect(listCalls).toEqual([]);
  });

  it("Enter picks the focused option and sends choose n, keeping the menu open and waiting", () => {
    const { controller, choiceMenu, sent, returnToList } = harness();
    choiceMenu.openWith(DRUNK);
    controller.handleKey("ArrowDown"); // focus option 2
    expect(controller.handleKey("Enter")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 2 }]);
    // Fix 1: the menu does NOT return focus between picks; it stays open and
    // waiting for the engine's reply (the next choices, or the end).
    expect(returnToList).not.toHaveBeenCalled();
    expect(choiceMenu.isOpen()).toBe(true);
    expect(choiceMenu.isWaiting()).toBe(true);
  });

  it("a number key picks that option directly and sends choose n, keeping the menu open and waiting", () => {
    const { controller, choiceMenu, sent } = harness();
    choiceMenu.openWith(DRUNK);
    expect(controller.handleKey("3")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 3 }]);
    expect(choiceMenu.isOpen()).toBe(true);
    expect(choiceMenu.isWaiting()).toBe(true);
  });

  it("while waiting for the engine's reply, Enter and number keys are consumed but pick nothing", () => {
    const { controller, choiceMenu, sent } = harness();
    choiceMenu.openWith(DRUNK);
    expect(controller.handleKey("Enter")).toBe(true); // pick option 1 -> waiting
    expect(sent).toEqual([{ verb: "choose", n: 1 }]);
    // Further picks are ignored (consumed, so they never reach the engine's
    // input, but they send no second choose while the engine is processing).
    expect(controller.handleKey("Enter")).toBe(true);
    expect(controller.handleKey("2")).toBe(true);
    expect(controller.handleKey("ArrowDown")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 1 }]);
    expect(choiceMenu.isWaiting()).toBe(true);
  });

  it("an out-of-range number key is still consumed but sends nothing", () => {
    const { controller, choiceMenu, sent } = harness();
    choiceMenu.openWith(DRUNK);
    // 7 is out of range for a 3-option menu: consumed (so it can't reach the
    // engine's input), but no choose command is sent and the menu stays open.
    expect(controller.handleKey("7")).toBe(true);
    expect(sent).toEqual([]);
    expect(choiceMenu.isOpen()).toBe(true);
  });

  it("R repeats the menu's own options locally (no engine round-trip) while phase is 'choice'", () => {
    const { controller, choiceMenu, sent, lines, setPhase } = harness();
    setPhase("choice");
    choiceMenu.openWith(DRUNK);
    lines.length = 0;
    expect(controller.handleKey("r")).toBe(true);
    // Fix B: with the player's own choice menu open, R repeats the options it
    // already holds as one composed line — whatever the phase — and never asks
    // the engine, so no `choices` command is sent.
    expect(sent).toEqual([]);
    expect(lines).toEqual([
      "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU? Option 2: GIVE ME A DRINK. Option 3: GOODBYE.",
    ]);
  });

  it("Escape is consumed, does not close the menu, and re-states how to choose", () => {
    const { controller, choiceMenu, sent, lines } = harness();
    choiceMenu.openWith(DRUNK);
    lines.length = 0;
    expect(controller.handleKey("Escape")).toBe(true);
    expect(choiceMenu.isOpen()).toBe(true); // engine is still waiting
    expect(sent).toEqual([]); // and Escape did NOT send `skip` as list mode does
    expect(lines).toEqual(["Pick an option with Up and Down, then Enter."]);
  });

  it("stops audio at the top of the handler, like every other key", () => {
    const { controller, choiceMenu, stopAudio } = harness();
    choiceMenu.openWith(DRUNK);
    controller.handleKey("ArrowDown");
    expect(stopAudio).toHaveBeenCalled();
  });

  it("H asks the ghost for a hint and leaves the menu open (Fix 1)", () => {
    const { controller, choiceMenu, askHint, sent } = harness();
    choiceMenu.openWith(DRUNK);
    // Lower and upper case both ask the ghost; neither picks a choice nor
    // sends a command to the engine, and the menu stays open for the pick.
    expect(controller.handleKey("h")).toBe(true);
    expect(controller.handleKey("H")).toBe(true);
    expect(askHint).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
    expect(choiceMenu.isOpen()).toBe(true);
  });

  it("L reads the whole room and leaves the menu open (Fix 1)", () => {
    const { controller, choiceMenu, readRoom, sent } = harness();
    choiceMenu.openWith(DRUNK);
    expect(controller.handleKey("l")).toBe(true);
    expect(controller.handleKey("L")).toBe(true);
    expect(readRoom).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
    expect(choiceMenu.isOpen()).toBe(true);
  });

  it("H and L are consumed so they never reach the engine's input (Fix 1)", () => {
    // Before the fix, h/l fell through the choice-menu handler and returned
    // false, so the key reached the game. Both must now be consumed.
    const { controller, choiceMenu } = harness();
    choiceMenu.openWith(DRUNK);
    expect(controller.handleKey("h")).toBe(true);
    expect(controller.handleKey("l")).toBe(true);
  });

  it("with the menu closed, the same keys fall through to list mode", () => {
    const { controller, choiceMenu, sent, listCalls } = harness();
    // Menu never opened: ArrowDown examines (sends look), ArrowUp interacts.
    expect(choiceMenu.isOpen()).toBe(false);
    controller.handleKey("ArrowRight");
    expect(listCalls).toContain("next");
    // Escape in list mode sends `skip` (the list-mode behaviour), proving the
    // choice-menu Escape handling only applies while the menu is open.
    controller.handleKey("Escape");
    expect(sent).toContainEqual({ verb: "skip" });
  });
});

describe("Controller Fix B: `skip` is never sent while a choice is pending", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("suppresses the list-mode Escape `skip` while the engine phase is 'choice', even with the menu closed", () => {
    // The permanent-busy dead state: during animation_16_2 the engine is in the
    // 'choice' phase but A11Y_CHOICES has not arrived yet, so the choice menu is
    // still closed and Escape reaches list mode. A `skip` there is exactly what
    // wedges the engine, so it must be suppressed.
    const { controller, choiceMenu, sent, readRoom, setPhase } = harness();
    setPhase("choice");
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("Escape")).toBe(true);
    expect(sent).toEqual([]); // no skip while a choice is pending
    expect(readRoom).toHaveBeenCalled(); // the key still gives one useful update
  });

  it("still sends the list-mode Escape `skip` when the phase is 'control'", () => {
    const { controller, choiceMenu, sent, setPhase } = harness();
    setPhase("control");
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("Escape")).toBe(true);
    expect(sent).toEqual([{ verb: "skip" }]);
  });

  it("still sends the list-mode Escape `skip` when no phase is known yet", () => {
    const { controller, choiceMenu, sent } = harness();
    // phase left undefined (no A11Y_PHASE seen yet): the guard falls back to the
    // choice menu's open state, which is closed, so skip is allowed.
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("Escape")).toBe(true);
    expect(sent).toEqual([{ verb: "skip" }]);
  });

  it("Enter in the choice menu chooses the focused option (never a skip) while phase is 'choice'", () => {
    const { controller, choiceMenu, sent, setPhase } = harness();
    setPhase("choice");
    choiceMenu.openWith(DRUNK);
    controller.handleKey("ArrowDown"); // focus option 2
    expect(controller.handleKey("Enter")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 2 }]);
    expect(sent).not.toContainEqual({ verb: "skip" });
  });

  it("R repeats the menu's own options locally even after the phase has moved on (busy): no `choices`, no stale live repeat", () => {
    const { controller, choiceMenu, sent, lines, repeat, setPhase } = harness();
    // The menu is still open (the page closes it on the next phase line), but
    // the engine has already left 'choice'. R repeats the options the menu
    // holds as one line — no engine round-trip — rather than replaying the last
    // spoken line, so a replay fallback phase can never surface a stale error.
    choiceMenu.openWith(DRUNK);
    setPhase("busy");
    lines.length = 0;
    expect(controller.handleKey("r")).toBe(true);
    expect(sent).toEqual([]); // no `choices` sent
    expect(repeat).not.toHaveBeenCalled(); // not a last-line repeat
    expect(lines).toEqual([
      "Pick a reply, 3 options. Option 1: HI BOSS, HOW ARE YOU? Option 2: GIVE ME A DRINK. Option 3: GOODBYE.",
    ]);
  });

  it("with the menu closed and phase 'choice', R asks the engine for its choices (sends `choices`)", () => {
    // The only window where R leaves to query the engine: the engine's phase is
    // 'choice' but A11Y_CHOICES has not arrived, so our own menu is not open yet
    // (mid animation). A plain R asks the engine to re-emit its choices so the
    // menu opens with engine truth.
    const { controller, choiceMenu, sent, repeat, setPhase } = harness();
    setPhase("choice");
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("r")).toBe(true);
    expect(sent).toEqual([{ verb: "choices" }]);
    expect(repeat).not.toHaveBeenCalled();
  });

  it("with the menu closed and phase 'busy', R just repeats the last line (no `choices`)", () => {
    const { controller, choiceMenu, sent, repeat, setPhase } = harness();
    setPhase("busy");
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("r")).toBe(true);
    expect(sent).toEqual([]); // not a choice pending, so no engine round-trip
    expect(repeat).toHaveBeenCalled(); // list-mode R just repeats
  });

  it("with the menu closed and no phase known yet, R just repeats the last line (no `choices`)", () => {
    const { controller, choiceMenu, sent, repeat } = harness();
    // phase left undefined (replay fallback / no A11Y_PHASE seen): not 'choice',
    // so R repeats rather than querying the engine.
    expect(choiceMenu.isOpen()).toBe(false);
    expect(controller.handleKey("r")).toBe(true);
    expect(sent).toEqual([]);
    expect(repeat).toHaveBeenCalled();
  });
});
