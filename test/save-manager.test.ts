import { describe, expect, it, vi } from "vitest";
import type { Command } from "../src/engine/adapter.js";
import {
  AUTOSAVE_SLOT,
  MANUAL_SLOT,
} from "../src/engine/persistence.js";
import {
  LOAD_FAILED_LINE,
  SAVED_LINE,
  SAVE_FAILED_LINE,
  SAVE_UNAVAILABLE_LINE,
  SaveManager,
  type Timer,
} from "../src/engine/save-manager.js";

/** A manual Timer whose scheduled callbacks are fired on demand. */
function controllableTimer() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const timer: Timer = {
    set(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timer,
    fireAll() {
      for (const [, fn] of pending) fn();
      pending.clear();
    },
    pendingCount: () => pending.size,
  };
}

function makeManager(opts?: {
  available?: boolean;
  commitResult?: boolean;
  latestSlot?: number | undefined;
  roomName?: (room: number) => string | undefined;
}) {
  const sent: Command[] = [];
  const announced: string[] = [];
  const reloadedInto: number[] = [];
  const commit = vi.fn(async () => opts?.commitResult ?? true);
  const { timer, fireAll, pendingCount } = controllableTimer();

  const manager = new SaveManager({
    send: (cmd) => sent.push(cmd),
    persistence: {
      isAvailable: () => opts?.available ?? true,
      commit,
      latestSlot: () => opts?.latestSlot,
    },
    announce: (t) => announced.push(t),
    roomName: opts?.roomName ?? ((room) => (room === 62 ? "tavern" : undefined)),
    requestReloadInto: (slot) => reloadedInto.push(slot),
    timer,
    watchdogMs: 1000,
  });

  return { manager, sent, announced, reloadedInto, commit, fireAll, pendingCount };
}

describe("SaveManager.save (manual)", () => {
  it("sends save to the manual slot and announces 'Saved.' when the save completes and commits", async () => {
    const m = makeManager({ commitResult: true });
    m.manager.save();
    expect(m.sent).toEqual([{ verb: "save", slot: MANUAL_SLOT }]);

    // A11Y_SAVED arrives for the manual slot.
    await m.manager.onSaved(MANUAL_SLOT);
    expect(m.commit).toHaveBeenCalledOnce();
    expect(m.announced).toEqual([SAVED_LINE]);
    // The watchdog was cancelled, so no failure line fires later.
    m.fireAll();
    expect(m.announced).toEqual([SAVED_LINE]);
  });

  it("announces the failure line when the commit does not stick", async () => {
    const m = makeManager({ commitResult: false });
    m.manager.save();
    await m.manager.onSaved(MANUAL_SLOT);
    expect(m.announced).toEqual([SAVE_FAILED_LINE]);
  });

  it("announces the failure line when the save never completes (watchdog fires)", () => {
    const m = makeManager();
    m.manager.save();
    expect(m.pendingCount()).toBe(1);
    // No A11Y_SAVED arrives; the watchdog fires.
    m.fireAll();
    expect(m.announced).toEqual([SAVE_FAILED_LINE]);
  });

  it("never promises 'Saved.' before the save completes", () => {
    const m = makeManager();
    m.manager.save();
    expect(m.announced).not.toContain(SAVED_LINE);
  });

  it("is honest when persistence is unavailable: states the in-browser reality, sends nothing", () => {
    const m = makeManager({ available: false });
    m.manager.save();
    expect(m.sent).toEqual([]);
    expect(m.announced).toEqual([SAVE_UNAVAILABLE_LINE]);
  });
});

describe("SaveManager autosave on room change", () => {
  it("does not autosave on the first room (a loaded slot must not be overwritten)", () => {
    const m = makeManager();
    m.manager.onRoomChange(); // first room
    expect(m.sent).toEqual([]);
  });

  it("autosaves into the reserved slot on later room changes, quietly", async () => {
    const m = makeManager();
    m.manager.onRoomChange(); // first room (gated)
    m.manager.onRoomChange(); // second room
    expect(m.sent).toEqual([{ verb: "save", slot: AUTOSAVE_SLOT }]);
    // The autosave's A11Y_SAVED commits with no spoken line.
    await m.manager.onSaved(AUTOSAVE_SLOT);
    expect(m.commit).toHaveBeenCalledOnce();
    expect(m.announced).toEqual([]);
  });

  it("does not autosave when persistence is unavailable", () => {
    const m = makeManager({ available: false });
    m.manager.onRoomChange();
    m.manager.onRoomChange();
    expect(m.sent).toEqual([]);
  });
});

describe("SaveManager.load", () => {
  it("requests a reload into the most recent slot when a save exists", () => {
    const m = makeManager({ latestSlot: 1 });
    m.manager.load();
    expect(m.reloadedInto).toEqual([1]);
  });

  it("announces a load failure when no save exists", () => {
    const m = makeManager({ latestSlot: undefined });
    m.manager.load();
    expect(m.reloadedInto).toEqual([]);
    expect(m.announced).toEqual([LOAD_FAILED_LINE]);
  });
});

describe("SaveManager loaded announcement", () => {
  it("announces 'Loaded: <room>' using the pack room name", () => {
    const m = makeManager();
    m.manager.announceLoaded(62);
    expect(m.announced).toEqual(["Loaded: tavern"]);
  });

  it("falls back to a bare 'Loaded.' when the room has no pack name", () => {
    const m = makeManager();
    m.manager.announceLoaded(999);
    expect(m.announced).toEqual(["Loaded."]);
  });

  it("announces a load failure for a continue boot that never reached a room", () => {
    const m = makeManager();
    m.manager.announceLoadFailed();
    expect(m.announced).toEqual([LOAD_FAILED_LINE]);
  });
});
