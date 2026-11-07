// Milestone hint-selection rule. Pure: depends only on the `after` graph and
// the set of reached milestones, not on live flags. This is the function the
// no-spoiler invariant is a statement about.
import type { Milestone, Pack } from "./types.js";

export interface Progress {
  /** The player's current chapter. */
  chapter: number;
  /** Ids of milestones already reached (latched). */
  reached: ReadonlySet<string>;
}

/**
 * The milestones whose hints may be offered now: not yet reached, and with
 * every `after` prerequisite reached. Order is file order; presentation (such
 * as preferring a milestone whose `rooms` include the current room) is a
 * concern for the runtime, not this invariant.
 */
export function offeredMilestones(
  pack: Pack,
  progress: Progress,
): Milestone[] {
  const milestones = pack.milestones ?? [];
  return milestones.filter((m) => {
    if (progress.reached.has(m.id)) return false;
    for (const dep of m.after ?? []) {
      if (!progress.reached.has(dep)) return false;
    }
    return true;
  });
}
