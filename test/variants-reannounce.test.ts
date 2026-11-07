// Re-announce-on-variant-change behaviour (description-variants R4).
//
// The decision lives inside main.ts's applyDiff and is not exported, so this
// test reproduces exactly what main.ts does with the same collaborators: it
// resolves the room's short and long BEFORE folding a diff (with a snapshot of
// the reached set), folds the diff through the real `foldDiff` and
// `ProgressTracker`, resolves again AFTER, and re-announces iff either changed.
// Driven against the real pack's room 5, whose short/long carry a flag-8
// variant (the church window opening).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { loadPack, Pack, type PackData } from "../src/model/pack.js";
import { foldDiff, type EngineHintState } from "../src/hints/fold.js";
import { ProgressTracker } from "../src/hints/progress.js";
import type { Pack as HintPack } from "../packs/tools/src/types.js";

function realPack(): { pack: Pack; hintPack: HintPack } {
  const url = new URL("../packs/drascula-en.json", import.meta.url);
  const raw = readFileSync(fileURLToPath(url), "utf8");
  return {
    pack: loadPack(JSON.parse(raw) as PackData),
    hintPack: JSON.parse(raw) as HintPack,
  };
}

/**
 * Replays main.ts's applyDiff re-announce decision for the current room.
 * Returns whether the room would be re-announced, and the resolved short
 * before and after the diff.
 */
function wouldReannounce(diff: Diff, start: EngineHintState) {
  const { pack, hintPack } = realPack();
  const tracker = new ProgressTracker(hintPack);
  tracker.update(start);

  const room = start.room;
  const reachedBefore = new Set(tracker.progress().reached);
  const shortBefore = pack.roomShortFor(room, start, reachedBefore);
  const longBefore = pack.roomLongFor(room, start, reachedBefore);

  const after = foldDiff(start, diff);
  tracker.update(after);
  const reachedAfter = tracker.progress().reached;
  const shortAfter = pack.roomShortFor(after.room, after, reachedAfter);
  const longAfter = pack.roomLongFor(after.room, after, reachedAfter);

  const sameRoom = after.room === room && diff.room === undefined && diff.chapter === undefined;
  const reannounce =
    sameRoom && (shortAfter !== shortBefore || longAfter !== longBefore);
  return { reannounce, shortBefore, shortAfter };
}

/** In room 5, chapter 2, with flag 8 not yet set and nothing carried. */
function room5Closed(): EngineHintState {
  return { chapter: 2, room: 5, flags: new Array(50).fill(0), inventory: [] };
}

describe("re-announce on variant change (R4)", () => {
  it("re-announces once when a same-room diff sets flag 8 (window opens)", () => {
    const diff: Diff = {
      cmd: "use 165 136",
      flags: { "8": [0, 1] },
      said: [{ color: "white", text: "You pull the boards off." }],
      changed: true,
    };
    const r = wouldReannounce(diff, room5Closed());
    expect(r.reannounce).toBe(true);
    // The resolved short actually changed: the default (no "open") gives way to
    // the flag-8 variant, which describes the window as open.
    expect(r.shortBefore).not.toContain("open");
    expect(r.shortAfter).toContain("open");
    expect(r.shortAfter).not.toBe(r.shortBefore);
  });

  it("does not re-announce for a same-room diff that touches no variant flag", () => {
    const diff: Diff = {
      cmd: "look 212",
      flags: { "19": [0, 1] }, // some unrelated flag
      said: [{ color: "white", text: "A full moon." }],
      changed: true,
    };
    const r = wouldReannounce(diff, room5Closed());
    expect(r.reannounce).toBe(false);
    expect(r.shortAfter).toBe(r.shortBefore);
  });

  it("does not re-announce for an empty (no-op) same-room diff", () => {
    const diff: Diff = { cmd: "look 213", changed: false };
    const r = wouldReannounce(diff, room5Closed());
    expect(r.reannounce).toBe(false);
  });

  it("does not re-announce when flag 8 was already set (variant unchanged)", () => {
    const already: EngineHintState = {
      chapter: 2,
      room: 5,
      flags: Object.assign(new Array(50).fill(0), { 8: 1 }),
      inventory: [],
    };
    const diff: Diff = {
      cmd: "look 212",
      flags: { "19": [0, 1] },
      changed: true,
    };
    const r = wouldReannounce(diff, already);
    expect(r.reannounce).toBe(false);
    // Both resolve to the open variant, so no change.
    expect(r.shortBefore).toContain("open");
    expect(r.shortAfter).toBe(r.shortBefore);
  });

  it("leaves a room-change diff to the normal room announcement (no extra re-announce)", () => {
    // A diff that changes the room is handled by the room-change path, which
    // returns early in main.ts; our decision helper reports no same-room
    // re-announce for it.
    const diff: Diff = {
      cmd: "walk 136",
      room: [5, 6],
      changed: true,
    };
    const r = wouldReannounce(diff, room5Closed());
    expect(r.reannounce).toBe(false);
  });
});
