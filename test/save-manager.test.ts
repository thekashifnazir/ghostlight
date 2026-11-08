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
  isSaveError,
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

describe("SaveManager.handleError (autosave errors never speak)", () => {
  /** Drive the manager to a point where an autosave is in flight. */
  function withPendingAutosave() {
    const m = makeManager();
    m.manager.onRoomChange(); // first room (gated, no save)
    m.manager.onRoomChange(); // second room -> autosave sent, pendingAuto set
    expect(m.sent).toEqual([{ verb: "save", slot: AUTOSAVE_SLOT }]);
    return m;
  }

  it("swallows a save error that arrives while an autosave is in flight (logs, does not speak)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = withPendingAutosave();
    const consumed = m.manager.handleError("save slot must be 1 or greater, got: 0");
    expect(consumed).toBe(true); // the page must stay silent
    expect(m.announced).toEqual([]); // nothing spoken
    expect(warn).toHaveBeenCalledOnce(); // logged for developers only
    warn.mockRestore();
  });

  it("only swallows one autosave error: a second save error (no autosave pending) passes through", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = withPendingAutosave();
    expect(m.manager.handleError("save needs a slot number")).toBe(true);
    // The in-flight autosave is now resolved; a later save error is not ours.
    expect(m.manager.handleError("save needs a slot number")).toBe(false);
    warn.mockRestore();
  });

  it("passes through a save error when no autosave is in flight (a manual save's error still speaks)", () => {
    const m = makeManager();
    // No room change -> no autosave pending. A manual save's failure surfaces
    // through onSaved/the watchdog, so handleError must not swallow it.
    const consumed = m.manager.handleError("save slot must be a number, got: x");
    expect(consumed).toBe(false);
  });

  it("never swallows an ordinary (non-save) game error, even with an autosave in flight", () => {
    const m = withPendingAutosave();
    const consumed = m.manager.handleError("no handler for command: fly");
    expect(consumed).toBe(false); // ordinary errors are the page's to announce
  });

  it("clears the in-flight autosave on A11Y_SAVED, so a later save error passes through", async () => {
    const m = withPendingAutosave();
    await m.manager.onSaved(AUTOSAVE_SLOT); // autosave completed -> pendingAuto cleared
    expect(m.manager.handleError("save slot must be 1 or greater, got: 0")).toBe(false);
  });
});

describe("isSaveError", () => {
  it("matches the engine's save rejection messages", () => {
    expect(isSaveError("save slot must be 1 or greater, got: 0")).toBe(true);
    expect(isSaveError("save slot must be a number, got: x")).toBe(true);
    expect(isSaveError("save needs a slot number, e.g. `save 1`")).toBe(true);
  });

  it("does not match ordinary game errors", () => {
    expect(isSaveError("no handler for command: fly")).toBe(false);
    expect(isSaveError("I DON'T HAVE A ROOM YET")).toBe(false);
    // "saved" is a different word (word boundary after "save"), not the verb.
    expect(isSaveError("saved the day")).toBe(false);
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
