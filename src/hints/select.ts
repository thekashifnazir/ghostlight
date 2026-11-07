// Target selection (Requirement 2). Pure.
//
// Picks the single milestone the ghost will hint at from the offered set. The
// offered set comes from the pack tools' `offeredMilestones` (imported, not
// reimplemented, R2.1): milestones not yet reached with every `after`
// prerequisite reached, in file order. Because the result is always an element
// of that set, the selection never hints at a milestone ahead of the player
// (the no-spoiler invariant, R2.2).
//
// The deterministic rule (R2.3–2.5):
//   1. prefer a milestone whose `rooms` include the current room;
//   2. within that, prefer a required milestone over an `optional` one;
//   3. break remaining ties by file order (the offered list's order).

import { offeredMilestones, type Progress } from "../../packs/tools/src/hints.js";
import type { Milestone, Pack } from "../../packs/tools/src/types.js";

/**
 * The one milestone to hint at, or `undefined` when nothing is offered (R2.6).
 */
export function selectTarget(
  pack: Pack,
  progress: Progress,
  room: number,
): Milestone | undefined {
  // Drop offered milestones from a chapter the player has already moved past:
  // Drascula's chapters are strictly sequential and cannot be revisited, so an
  // unreached earlier-chapter milestone is no longer reachable and must not be
  // hinted at (e.g. a ch1 start that never latched because the session began in
  // ch2). The result stays a subset of the offered set, so the no-spoiler
  // invariant is unaffected.
  const offered = offeredMilestones(pack, progress).filter(
    (m) => m.chapter >= progress.chapter,
  );
  if (offered.length === 0) return undefined;

  // Rank by (room preference, required-over-optional). Ties keep offered order,
  // which is file order; a stable sort preserves it.
  const rank = (m: Milestone): number => {
    const inRoom = m.rooms?.includes(room) ? 0 : 1;
    const required = m.optional ? 1 : 0;
    return inRoom * 2 + required;
  };

  let best = offered[0];
  let bestRank = rank(best);
  for (let i = 1; i < offered.length; i++) {
    const r = rank(offered[i]);
    if (r < bestRank) {
      best = offered[i];
      bestRank = r;
    }
  }
  return best;
}
