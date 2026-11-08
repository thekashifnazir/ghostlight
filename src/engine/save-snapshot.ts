// Save snapshot contract (save-progress Requirement 6.1).
//
// The engine owns the real save file; the page owns a small, independent record
// of the player-visible state a save is expected to round-trip: the room, the
// chapter, the progress flags, and the inventory. This is the exact shape the
// page already keeps while playing (the running EngineHintState folded from
// A11Y lines), so "save then load restores room, flags and inventory" is a
// property over this snapshot: serialize a state, deserialize it, and the
// result must equal the original.
//
// The page uses this to (a) assert a continue/load landed on the state it saved
// (the Playwright check and the round-trip property), and (b) record the
// "continue from slot N" intent across a page-reload load. It is NOT a second
// copy of ScummVM's save I/O — the engine still writes and reads the actual
// save file. This is the page's contract view of what that save must preserve.

import type { EngineHintState } from "../hints/fold.js";

/** The player-visible state a save must round-trip (room, chapter, flags, inv). */
export type SaveSnapshot = EngineHintState;

/** Serialize a snapshot to a compact JSON string (what a page-side record holds). */
export function serializeSnapshot(state: SaveSnapshot): string {
  return JSON.stringify({
    chapter: state.chapter,
    room: state.room,
    flags: state.flags,
    inventory: state.inventory,
  });
}

/**
 * Parse a snapshot back from its serialized form. Throws on malformed input so
 * a corrupt record is a loud failure the load path turns into a spoken "load
 * failed" rather than a silently wrong resume.
 */
export function deserializeSnapshot(text: string): SaveSnapshot {
  const raw = JSON.parse(text) as Partial<SaveSnapshot>;
  if (
    typeof raw.chapter !== "number" ||
    typeof raw.room !== "number" ||
    !Array.isArray(raw.flags) ||
    !Array.isArray(raw.inventory)
  ) {
    throw new Error("malformed save snapshot");
  }
  return {
    chapter: raw.chapter,
    room: raw.room,
    flags: raw.flags.slice(),
    inventory: raw.inventory.slice(),
  };
}

/** True when two snapshots hold the same room, chapter, flags and inventory. */
export function snapshotsEqual(a: SaveSnapshot, b: SaveSnapshot): boolean {
  return (
    a.chapter === b.chapter &&
    a.room === b.room &&
    a.flags.length === b.flags.length &&
    a.flags.every((v, i) => v === b.flags[i]) &&
    sameMembers(a.inventory, b.inventory)
  );
}

/** Set equality on item ids (inventory order is not meaningful). */
function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}
