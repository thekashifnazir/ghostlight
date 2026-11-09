// '?' is an alias for F1 (controls help) in list mode, and must not collide
// with '/' (which opens the command box). These tests drive the Controller the
// way the page does — one key through handleKey — with a fake readHelp and a
// fake command box, and prove: '?' reads the help exactly like F1; '/' still
// opens the command box and does NOT read help; and '?' does not open the box.
import { describe, expect, it, vi } from "vitest";
import type { Command, EngineAdapter } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import type { CommandBox } from "../src/ui/command-box.js";
import type { Inventory } from "../src/ui/inventory.js";
import type { ListMode } from "../src/ui/list-mode.js";
import type { LiveRegion } from "../src/ui/live-region.js";
import type { Pack } from "../src/model/pack.js";
import type { Sonar } from "../src/sonar/sonar.js";
import type { VerbMenu } from "../src/ui/verb-menu.js";
import { Controller } from "../src/ui/controller.js";

const FOCUSED: Hotspot = {
  num: 53,
  kind: "npc",
  name: "drunk",
  rect: [277, 93, 36, 67],
  walkTo: [285, 160],
};

function harness() {
  const sent: Command[] = [];
  const adapter = {
    send: (cmd: Command) => void sent.push(cmd),
    start: () => Promise.resolve(),
    onEvent: () => () => {},
  } as unknown as EngineAdapter;

  const readHelp = vi.fn();

  // A command box stub: records openBox() calls, and reports closed so list-mode
  // routing applies (open/closed gates where keys go).
  let boxOpen = false;
  const openBox = vi.fn(() => {
    boxOpen = true;
  });
  const commandBox = {
    isOpen: () => boxOpen,
    openBox,
    handleKey: () => true,
  } as unknown as CommandBox;

  const list = {
    current: () => FOCUSED,
    next: vi.fn(),
    prev: vi.fn(),
    announceCurrent: vi.fn(),
  } as unknown as ListMode;

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
    commandBox,
    live: {
      announce: () => {},
      repeat: () => {},
      resetHistoryCursor: () => {},
    } as unknown as LiveRegion,
    showHighlight: () => {},
    readRoom: vi.fn(),
    readHelp,
    stopAudio: vi.fn(),
    askHint: vi.fn(),
    toggleGhostVoice: vi.fn(),
    sonar: { stop: () => {} } as unknown as Sonar,
  });

  return { controller, readHelp, openBox, isBoxOpen: () => boxOpen };
}

describe("'?' reads controls help (F1 alias) in list mode", () => {
  it("'?' calls readHelp, exactly like F1, and consumes the key", () => {
    const { controller, readHelp } = harness();
    expect(controller.handleKey("?")).toBe(true);
    expect(readHelp).toHaveBeenCalledTimes(1);
  });

  it("F1 also reads help (unchanged)", () => {
    const { controller, readHelp } = harness();
    expect(controller.handleKey("F1")).toBe(true);
    expect(readHelp).toHaveBeenCalledTimes(1);
  });

  it("'?' does NOT open the command box", () => {
    const { controller, openBox } = harness();
    controller.handleKey("?");
    expect(openBox).not.toHaveBeenCalled();
  });

  it("'/' opens the command box and does NOT read help (no collision)", () => {
    const { controller, readHelp, openBox } = harness();
    expect(controller.handleKey("/")).toBe(true);
    expect(openBox).toHaveBeenCalledTimes(1);
    expect(readHelp).not.toHaveBeenCalled();
  });
});
