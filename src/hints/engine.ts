// HintEngine (Requirements 2, 3, 4, 5.2, 8.8).
//
// Ties reached-set tracking, target selection and tier progression into the two
// calls the player uses. `onEngineState` forwards each folded state to the
// tracker so `reached` stays current. `ask` gives the next tier up for the one
// target milestone; `askAnswer` gives its answer directly. Both return the
// tier's text (always complete on its own, R5.2) and the audio cache key so the
// player can write the text then resolve the optional whisper.
//
// The returned key is content-addressed over the exact text, the ghost voice
// and the model, so it matches the file the generator wrote for that same line
// (R8.8). `ask`/`askAnswer` are async only because the shared cache key is
// computed with an async hash; selection and tier logic are synchronous.

import type { Milestone, Pack } from "../../packs/tools/src/types.js";
import { cacheKey } from "./cache.js";
import type { ProgressTracker } from "./progress.js";
import type { EngineHintState } from "./fold.js";
import { selectTarget } from "./select.js";
import {
  answerTier,
  nextTier,
  type AnswerCount,
  type Tier,
  type TierOutcome,
  type TierState,
} from "./tiers.js";

/** The ghost voice and model the cache keys are computed against (R8.2). */
export const GHOST_VOICE_ID = "nbk2esDn4RRk4cVDdoiE";
export const GHOST_MODEL_ID = "eleven_v4";

/**
 * Spoken once the answer tier has been given twice for a milestone, instead of
 * repeating the answer a third time. Functional text: it still goes to the live
 * region like any hint, and a cached whisper for it need not exist.
 */
export const HINT_EXHAUSTED_TEXT = "That's all I can tell you here";

export type HintResult =
  | { kind: "none" }
  | {
      kind: "hint";
      milestoneId: string;
      tier: Tier;
      text: string;
      audioKey: string;
    }
  | {
      kind: "exhausted";
      milestoneId: string;
      text: string;
      audioKey: string;
    };

export class HintEngine {
  private readonly pack: Pack;
  private readonly tracker: ProgressTracker;
  private readonly tiers: TierState = new Map();
  private readonly answers: AnswerCount = new Map();

  constructor(pack: Pack, tracker: ProgressTracker) {
    this.pack = pack;
    this.tracker = tracker;
  }

  /** Forward a folded engine state so the reached set stays current. */
  onEngineState(state: EngineHintState): void {
    this.tracker.update(state);
  }

  /**
   * The latched reached milestone set as of the last folded state. Used by the
   * player to resolve description variants that key on a milestone
   * (description-variants R2.5). Flag- and inventory-keyed variants do not need
   * it, but passing it keeps milestone-keyed variants correct.
   */
  reached(): ReadonlySet<string> {
    return this.tracker.progress().reached;
  }

  /** The next tier up for the current target, or `none` when nothing is offered. */
  async ask(room: number): Promise<HintResult> {
    const target = selectTarget(this.pack, this.tracker.progress(), room);
    if (!target) return { kind: "none" };
    const outcome = nextTier(this.tiers, this.answers, target.id);
    return this.result(target, outcome);
  }

  /** The answer directly for the current target, still only if offered (R4.3). */
  async askAnswer(room: number): Promise<HintResult> {
    const target = selectTarget(this.pack, this.tracker.progress(), room);
    if (!target) return { kind: "none" };
    const outcome = answerTier(this.tiers, this.answers, target.id);
    return this.result(target, outcome);
  }

  private async result(
    target: Milestone,
    outcome: TierOutcome,
  ): Promise<HintResult> {
    if (outcome.kind === "exhausted") {
      const audioKey = await cacheKey(
        HINT_EXHAUSTED_TEXT,
        GHOST_VOICE_ID,
        GHOST_MODEL_ID,
      );
      return {
        kind: "exhausted",
        milestoneId: target.id,
        text: HINT_EXHAUSTED_TEXT,
        audioKey,
      };
    }
    const text = target.hints[outcome.tier];
    const audioKey = await cacheKey(text, GHOST_VOICE_ID, GHOST_MODEL_ID);
    return {
      kind: "hint",
      milestoneId: target.id,
      tier: outcome.tier,
      text,
      audioKey,
    };
  }
}
