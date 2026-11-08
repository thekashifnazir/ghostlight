// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, InvItem } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { CommandBox } from "../src/ui/command-box.js";

// The vending-room candidate set: the machine hotspot (188) and two carried
// items. "use coins on machine" must resolve to `use 18 188`.
const MACHINE: Hotspot = {
  num: 188,
  kind: "object",
  name: "vending machine",
  rect: [248, 70, 46, 90],
  walkTo: [268, 160],
};
const CURTAIN: Hotspot = {
  num: 206,
  kind: "object",
  name: "curtain",
  rect: [84, 60, 30, 70],
  walkTo: [100, 160],
};
const COINS: InvItem = { id: 18, name: "two coins" };
const KEY: InvItem = { id: 28, name: "room key" };

function setup(visible: Hotspot[] = [MACHINE, CURTAIN], inventory: InvItem[] = [COINS, KEY]) {
  document.body.innerHTML = `
    <div id="box" hidden>
      <label for="in">Type a command</label>
      <input id="in" type="text" />
    </div>`;
  const el = document.getElementById("box")!;
  const input = document.getElementById("in") as HTMLInputElement;
  const announce = vi.fn();
  const send = vi.fn<(cmd: Command) => void>();
  const returnToList = vi.fn();
  const runFixed = vi.fn();
  const examineHotspot = vi.fn<(h: Hotspot) => void>();
  const box = new CommandBox(el, input, {
    announce,
    send,
    visible: () => visible,
    inventory: () => inventory,
    parseContext: () => ({ inConversation: false, pendingChoice: false }),
    returnToList,
    runFixed,
    examineHotspot,
  });
  return { el, input, box, announce, send, returnToList, runFixed, examineHotspot };
}

/** Type a phrase into the input and submit with Enter. */
function type(input: HTMLInputElement, box: CommandBox, phrase: string): void {
  input.value = phrase;
  box.handleKey("Enter");
}

describe("CommandBox", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens hidden, then shows and focuses the input with an announcement", () => {
    const { el, input, box, announce } = setup();
    expect(el.hidden).toBe(true);
    box.openBox();
    expect(box.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("parses 'use coins on machine' and sends use 18 188", () => {
    const { input, box, send, returnToList } = setup();
    box.openBox();
    type(input, box, "use coins on machine");
    expect(send).toHaveBeenCalledWith({ verb: "use", item: 18, target: 188 });
    expect(returnToList).toHaveBeenCalled();
    expect(box.isOpen()).toBe(false);
  });

  it("Escape closes without sending and returns focus to the list", () => {
    const { box, send, returnToList } = setup();
    box.openBox();
    const consumed = box.handleKey("Escape");
    expect(consumed).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(returnToList).toHaveBeenCalled();
    expect(box.isOpen()).toBe(false);
  });

  it("leaves ordinary keys for the native input (not consumed)", () => {
    const { box } = setup();
    box.openBox();
    expect(box.handleKey("a")).toBe(false);
    expect(box.handleKey(" ")).toBe(false);
  });

  it("does not send an unknown phrase; announces the present things", () => {
    const { input, box, send, announce } = setup();
    box.openBox();
    announce.mockClear();
    type(input, box, "polish the gargoyle");
    expect(send).not.toHaveBeenCalled();
    expect(box.isOpen()).toBe(true); // stays open to refine
    const line = announce.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("vending machine");
  });

  it("announces the options for an ambiguous phrase and does not send", () => {
    // Two hotspots that both match "door" tie, so the parser returns ambiguous.
    const front: Hotspot = { ...MACHINE, num: 1, name: "front door", kind: "exit" };
    const back: Hotspot = { ...MACHINE, num: 2, name: "back door", kind: "exit" };
    const { input, box, send, announce } = setup([front, back], []);
    box.openBox();
    announce.mockClear();
    type(input, box, "door");
    expect(send).not.toHaveBeenCalled();
    const line = announce.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("front door");
    expect(line).toContain("back door");
  });

  it("runs a fixed phrase through the page's handler, not the engine", () => {
    const { input, box, send, runFixed } = setup();
    box.openBox();
    type(input, box, "inventory");
    expect(send).not.toHaveBeenCalled();
    expect(runFixed).toHaveBeenCalledWith("inventory");
    expect(box.isOpen()).toBe(false);
  });

  it("sends a bare hotspot name as its default interaction", () => {
    const { input, box, send } = setup();
    box.openBox();
    type(input, box, "machine");
    // A plain object defaults to `take`, which the engine routes to the
    // object's own primary action.
    expect(send).toHaveBeenCalledWith({ verb: "take", target: 188 });
  });

  describe("typed look/examine at a hotspot routes through the examine path (fix 2)", () => {
    // An NPC hotspot (like the tavern bartender, engine hotspot 52) whose raw
    // engine look is the useless stock "I CAN'T SEE ANYTHING IN PARTICULAR".
    const BARTENDER: Hotspot = {
      num: 52,
      kind: "npc",
      name: "bartender",
      rect: [120, 40, 40, 80],
      walkTo: [140, 150],
    };

    it("'look at bartender' calls examineHotspot and does NOT send a raw look", () => {
      const { input, box, send, examineHotspot } = setup([BARTENDER], []);
      box.openBox();
      type(input, box, "look at bartender");
      expect(examineHotspot).toHaveBeenCalledWith(BARTENDER);
      expect(send).not.toHaveBeenCalled();
      expect(box.isOpen()).toBe(false); // the box closes, like Down does
    });

    it("'examine bartender' routes the same way (examine is a look synonym)", () => {
      const { input, box, send, examineHotspot } = setup([BARTENDER], []);
      box.openBox();
      type(input, box, "examine bartender");
      expect(examineHotspot).toHaveBeenCalledWith(BARTENDER);
      expect(send).not.toHaveBeenCalled();
    });

    it("a look at an inventory ITEM still sends look <id>, not the examine path", () => {
      const { input, box, send, examineHotspot } = setup([BARTENDER], [COINS]);
      box.openBox();
      type(input, box, "look at coins");
      expect(examineHotspot).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith({ verb: "look", target: 18 });
    });

    it("falls back to a raw look when no examineHotspot is wired", () => {
      // A consumer that only resolves commands (no page examine path) still
      // gets a sendable command rather than nothing.
      document.body.innerHTML = `
        <div id="box" hidden>
          <label for="in">Type a command</label>
          <input id="in" type="text" />
        </div>`;
      const el = document.getElementById("box")!;
      const input = document.getElementById("in") as HTMLInputElement;
      const send = vi.fn<(cmd: Command) => void>();
      const box = new CommandBox(el, input, {
        announce: vi.fn(),
        send,
        visible: () => [BARTENDER],
        inventory: () => [],
        parseContext: () => ({ inConversation: false, pendingChoice: false }),
        returnToList: vi.fn(),
        runFixed: vi.fn(),
        // examineHotspot intentionally omitted
      });
      box.openBox();
      input.value = "look at bartender";
      box.handleKey("Enter");
      expect(send).toHaveBeenCalledWith({ verb: "look", target: 52 });
    });
  });
});
