// Chapter saves and the quit key (tester feedback, 16 Nov: "how do you quit the
// game if you want to quit the game and go back to a previous chapter?").
import { describe, expect, it, vi } from "vitest";
import type { Command } from "../src/engine/adapter.js";
import {
  AUTOSAVE_SLOT,
  CHAPTER_SLOT_BASE,
  MANUAL_SLOT,
  chapterOfSlot,
  chapterSlot,
  probeSaves,
} from "../src/engine/persistence.js";
import {
  QUIT_LINE,
  SAVE_FAILED_LINE,
  SAVE_UNAVAILABLE_LINE,
  SaveManager,
  type Timer,
} from "../src/engine/save-manager.js";

function makeManager(opts?: { available?: boolean; commitResult?: boolean }) {
  const sent: Command[] = [];
  const announced: string[] = [];
  const reloads: string[] = [];
  const pending = new Map<number, () => void>();
  let id = 1;
  const timer: Timer = {
    set(fn) {
      pending.set(id, fn);
      return id++;
    },
    clear(h) {
      pending.delete(h as number);
    },
  };
  const manager = new SaveManager({
    send: (c) => sent.push(c),
    persistence: {
      isAvailable: () => opts?.available ?? true,
      commit: vi.fn(async () => opts?.commitResult ?? true),
      latestSlot: () => undefined,
    },
    announce: (t) => announced.push(t),
    roomName: () => undefined,
    requestReloadInto: () => {},
    reloadToStart: () => reloads.push("start"),
    timer,
    watchdogMs: 1000,
  });
  const fireTimers = () => {
    for (const [, fn] of pending) fn();
    pending.clear();
  };
  return { manager, sent, announced, reloads, fireTimers };
}

const slots = (sent: Command[]) =>
  sent.map((c) => (c as { verb: string; slot?: number }).slot);

describe("chapter save slots", () => {
  it("keeps chapter slots clear of the manual slot and the autosave", () => {
    for (let n = 2; n <= 6; n++) {
      expect(chapterSlot(n)).toBe(CHAPTER_SLOT_BASE + n);
      expect(chapterSlot(n)).not.toBe(MANUAL_SLOT);
      expect(chapterSlot(n)).not.toBe(AUTOSAVE_SLOT);
      expect(chapterOfSlot(chapterSlot(n))).toBe(n);
    }
    expect(chapterOfSlot(MANUAL_SLOT)).toBeUndefined();
    expect(chapterOfSlot(AUTOSAVE_SLOT)).toBeUndefined();
  });
});

describe("SaveManager.onChapterStart", () => {
  it("saves the chapter start after the room-change autosave lands, quietly", async () => {
    const { manager, sent, announced } = makeManager();
    manager.onRoomChange(); // first room: gated
    manager.onRoomChange(); // the crossing's room change: autosave sent
    manager.onChapterStart(3);
    expect(slots(sent)).toEqual([AUTOSAVE_SLOT]); // one command at a time
    await manager.onSaved(AUTOSAVE_SLOT);
    expect(slots(sent)).toEqual([AUTOSAVE_SLOT, chapterSlot(3)]);
    await manager.onSaved(chapterSlot(3));
    expect(announced).toEqual([]); // never spoken
  });

  it("sends at once when no autosave is in flight", () => {
    const { manager, sent } = makeManager();
    manager.onChapterStart(2);
    expect(slots(sent)).toEqual([chapterSlot(2)]);
  });

  it("does nothing for chapter 1 or without persistence", () => {
    const a = makeManager();
    a.manager.onChapterStart(1);
    expect(a.sent).toEqual([]);
    const b = makeManager({ available: false });
    b.manager.onChapterStart(4);
    expect(b.sent).toEqual([]);
  });

  it("swallows a chapter save's engine error", () => {
    const { manager } = makeManager();
    manager.onChapterStart(5);
    expect(manager.handleError("save slot must be 1 or greater, got: 0")).toBe(true);
  });
});

describe("SaveManager.quit", () => {
  it("saves to the manual slot, says so, then goes back to the start screen", async () => {
    const { manager, sent, announced, reloads } = makeManager();
    manager.quit();
    expect(slots(sent)).toEqual([MANUAL_SLOT]);
    expect(reloads).toEqual([]);
    await manager.onSaved(MANUAL_SLOT);
    expect(announced).toEqual([QUIT_LINE]);
    expect(reloads).toEqual(["start"]);
  });

  it("stays in the game when the save doesn't land", () => {
    const { manager, announced, reloads, fireTimers } = makeManager();
    manager.quit();
    fireTimers();
    expect(announced).toEqual([SAVE_FAILED_LINE]);
    expect(reloads).toEqual([]);
  });

  it("stays in the game when the commit fails", async () => {
    const { manager, announced, reloads } = makeManager({ commitResult: false });
    manager.quit();
    await manager.onSaved(MANUAL_SLOT);
    expect(announced).toEqual([SAVE_FAILED_LINE]);
    expect(reloads).toEqual([]);
  });

  it("says saving isn't possible and stays, without persistence", () => {
    const { manager, sent, announced, reloads } = makeManager({ available: false });
    manager.quit();
    expect(sent).toEqual([]);
    expect(announced).toEqual([SAVE_UNAVAILABLE_LINE]);
    expect(reloads).toEqual([]);
  });

  it("a plain save after a failed quit just says Saved", async () => {
    const { manager, announced, reloads, fireTimers } = makeManager();
    manager.quit();
    fireTimers();
    manager.save();
    await manager.onSaved(MANUAL_SLOT);
    expect(announced.at(-1)).toBe("Saved.");
    expect(reloads).toEqual([]);
  });
});

/** A fake IndexedDB holding the given save-file keys, for probeSaves. */
function fakeIDB(keys: string[]): IDBFactory {
  const req = <T>(result: T) => {
    const r: { result: T; onsuccess?: () => void; onerror?: () => void } = { result };
    queueMicrotask(() => r.onsuccess?.());
    return r;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => ({ getAllKeys: () => req(keys) }) }),
    close: () => {},
  };
  return { open: () => req(db) } as unknown as IDBFactory;
}

describe("probeSaves with chapter saves", () => {
  it("lists the chapters reached and never picks a chapter save for Continue", async () => {
    const r = await probeSaves(
      fakeIDB(["/saves/drascula.093", "/saves/drascula.092", "/saves/drascula.099", "/saves/drascula.001"]),
    );
    expect(r.chapters).toEqual([2, 3]);
    expect(r.latestSlot).toBe(MANUAL_SLOT);
  });

  it("prefers the autosave over a chapter save when there's no manual save", async () => {
    const r = await probeSaves(fakeIDB(["/saves/drascula.094", "/saves/drascula.099"]));
    expect(r.latestSlot).toBe(AUTOSAVE_SLOT);
    expect(r.chapters).toEqual([4]);
  });

  it("falls back to the latest chapter save when that's all there is", async () => {
    const r = await probeSaves(fakeIDB(["/saves/drascula.092", "/saves/drascula.095"]));
    expect(r.hasSave).toBe(true);
    expect(r.latestSlot).toBe(chapterSlot(5));
  });
});
