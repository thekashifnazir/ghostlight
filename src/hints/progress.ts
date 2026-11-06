// Progress tracker with latching (Requirement 1.3, 1.4, 1.5).
//
// Holds the latched reached set and the current chapter. `update(state)` unions
// the currently-satisfied milestones into the reached set (add only, never
// remove) and records the chapter; `progress()` returns the `{ chapter, reached }`
// value `offeredMilestones` consumes. Because a `when.milestone` reference can
// only be satisfied once another milestone is reached, `update` iterates to a
// fixed point within one call so a chain of same-tick satisfactions all latch.

import type { Pack } from "../../packs/tools/src/types.js";
import type { EngineHintState } from "./fold.js";
import { satisfiedMilestones } from "./reached.js";

export interface Progress {
  chapter: number;
  reached: ReadonlySet<string>;
}

export class ProgressTracker {
  private readonly pack: Pack;
  private readonly reached = new Set<string>();
  private chapter = 1;

  constructor(pack: Pack) {
    this.pack = pack;
  }

  /**
   * Fold one complete engine state into the latched reached set. Only adds
   * ids, never removes one (a milestone stays reached once reached, R1.3/1.4).
   * Iterates to a fixed point so `when.milestone` chains all latch in one call.
   */
  update(state: EngineHintState): void {
    this.chapter = state.chapter;
    for (;;) {
      const before = this.reached.size;
      const satisfied = satisfiedMilestones(this.pack, state, this.reached);
      for (const id of satisfied) this.reached.add(id);
      if (this.reached.size === before) break;
    }
  }

  /** The `{ chapter, reached }` value `offeredMilestones` consumes. */
  progress(): Progress {
    return { chapter: this.chapter, reached: this.reached };
  }
}
