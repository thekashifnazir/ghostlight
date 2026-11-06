// Fold a sparse engine diff onto a complete running state (Requirement 11).
//
// A full room state (A11Y) carries all 50 flags and the full inventory, but a
// diff (A11Y_DIFF) carries only the flags that changed (a sparse map) and the
// items gained or lost (deltas). The hint core needs a complete flag array and
// inventory to evaluate milestone conditions, so this folds each diff forward
// onto the previous complete state. Pure: it never mutates `prev`.

import type { Diff } from "../engine/adapter.js";

/** A complete engine state for hint evaluation: full flags and inventory. */
export interface EngineHintState {
  chapter: number;
  room: number;
  /** The full 50-flag array, not a sparse delta. */
  flags: number[];
  /** The full inventory of real item ids, not a delta. */
  inventory: number[];
}

/**
 * Return the next complete state after applying one diff to `prev`. Does not
 * mutate `prev`: flags and inventory are copied before any change.
 *
 * - Flags: copy `prev.flags`, then set each changed index to the diff's `to`
 *   value; unchanged flags keep their previous value (R11.2).
 * - Inventory: copy `prev.inventory`, add each `invAdded` id not already
 *   present, remove each `invRemoved` id (R11.3).
 * - Chapter/room: take a change's `to` value, else keep `prev`'s (R11.4).
 */
export function foldDiff(prev: EngineHintState, diff: Diff): EngineHintState {
  const flags = prev.flags.slice();
  if (diff.flags) {
    for (const [index, change] of Object.entries(diff.flags)) {
      const i = Number(index);
      flags[i] = change[1];
    }
  }

  let inventory = prev.inventory.slice();
  for (const added of diff.invAdded ?? []) {
    if (!inventory.includes(added.id)) inventory.push(added.id);
  }
  if (diff.invRemoved?.length) {
    const removed = new Set(diff.invRemoved.map((r) => r.id));
    inventory = inventory.filter((id) => !removed.has(id));
  }

  const chapter = diff.chapter ? diff.chapter[1] : prev.chapter;
  const room = diff.room ? diff.room[1] : prev.room;

  return { chapter, room, flags, inventory };
}
