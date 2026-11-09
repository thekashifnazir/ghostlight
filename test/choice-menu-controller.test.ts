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
  document.body.innerHTML = `<div id="m" role="menu"></div>`;
  const el = document.getElementById("m")!;

  const sent: Command[] = [];
  const adapter = {
    send: (cmd: Command) => void sent.push(cmd),
    start: () => Promise.resolve(),
    onEvent: () => () => {},
  } as unknown as EngineAdapter;

  const lines: string[] = [];
  const live = { announce: (t: string) => void lines.push(t) } as unknown as LiveRegion;

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
    live,
    showHighlight: () => {},
    readRoom: () => {},
    readHelp: () => {},
    stopAudio,
    askHint: () => {},
    toggleGhostVoice: () => {},
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  return { controller, choiceMenu, adapter, sent, lines, listCalls, returnToList, stopAudio };
}

describe("Controller routing: conversation choice menu", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("routes arrows to the menu and consumes them (none reach list mode)", () => {
    const { controller, choiceMenu, listCalls } = harness();
    choiceMenu.openWith(DRUNK);
    const items = document.querySelectorAll('[role="menuitem"]');

    expect(controller.handleKey("ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    expect(controller.handleKey("ArrowUp")).toBe(true);
    expect(document.activeElement).toBe(items[0]);
    // List navigation was never touched while the menu owned the keyboard.
    expect(listCalls).toEqual([]);
  });

  it("Enter picks the focused option and sends choose n", () => {
    const { controller, choiceMenu, sent, returnToList } = harness();
    choiceMenu.openWith(DRUNK);
    controller.handleKey("ArrowDown"); // focus option 2
    expect(controller.handleKey("Enter")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 2 }]);
    expect(returnToList).toHaveBeenCalled();
    expect(choiceMenu.isOpen()).toBe(false);
  });

  it("a number key picks that option directly and sends choose n", () => {
    const { controller, choiceMenu, sent } = harness();
    choiceMenu.openWith(DRUNK);
    expect(controller.handleKey("3")).toBe(true);
    expect(sent).toEqual([{ verb: "choose", n: 3 }]);
    expect(choiceMenu.isOpen()).toBe(false);
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

  it("R repeats all the options as one line and is consumed", () => {
    const { controller, choiceMenu, lines } = harness();
    choiceMenu.openWith(DRUNK);
    lines.length = 0;
    expect(controller.handleKey("r")).toBe(true);
    expect(lines).toEqual([
      "1. HI BOSS, HOW ARE YOU? 2. GIVE ME A DRINK. 3. GOODBYE.",
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
