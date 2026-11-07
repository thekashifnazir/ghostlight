// Tier progression (Requirements 3, 4). Pure over plain data.
//
// Tier state is a `Map<string, Tier>` keyed by milestone id and owned by the
// caller, so each milestone progresses independently and returning to an
// earlier milestone continues from its own tier (R3.6). "Reset on target
// change" (R3.5) is implicit: a new milestone id has no recorded tier, so
// `nextTier` returns `nudge`. No DOM, engine or network dependency.
//
// Exhaustion: once the answer tier has actually been emitted twice for a
// milestone, the ghost has nothing left to add. Further asks yield an
// `exhausted` outcome instead of a third answer, so the player hears "That's
// all I can tell you here" rather than the same answer again. The count of
// answer emissions is held in a separate per-milestone map owned by the caller,
// so exhaustion is independent per milestone just like the tier itself.

export type Tier = "nudge" | "clue" | "answer";

export type TierState = Map<string, Tier>;

/** Per-milestone count of how many times the answer tier has been emitted. */
export type AnswerCount = Map<string, number>;

/**
 * The outcome of asking for a tier: either a tier to speak, or `exhausted` once
 * the answer has already been given twice for this milestone.
 */
export type TierOutcome =
  | { kind: "tier"; tier: Tier }
  | { kind: "exhausted" };

/** How many answer emissions are allowed before the milestone is exhausted. */
const ANSWER_LIMIT = 2;

const ORDER: readonly Tier[] = ["nudge", "clue", "answer"];

/** The tier after `t`, clamped at `answer`. */
function step(t: Tier): Tier {
  const i = ORDER.indexOf(t);
  return ORDER[Math.min(i + 1, ORDER.length - 1)];
}

/**
 * Record one answer emission for `id` and decide whether it is allowed. Returns
 * the `answer` tier for the first two emissions, then `exhausted` for every ask
 * after that (R4, exhaustion). Only call when the resolved tier is `answer`.
 */
function emitAnswer(counts: AnswerCount, id: string): TierOutcome {
  const given = counts.get(id) ?? 0;
  if (given >= ANSWER_LIMIT) return { kind: "exhausted" };
  counts.set(id, given + 1);
  return { kind: "tier", tier: "answer" };
}

/**
 * The next tier for `id` on a plain ask. A milestone with no recorded tier
 * starts at `nudge` (R3.1); otherwise step up one tier, clamped at `answer`
 * (R3.2, R3.3). Never skips a tier (R3.4). Records the returned tier in `state`.
 * Once the clamped answer has been emitted twice, yields `exhausted`.
 */
export function nextTier(
  state: TierState,
  counts: AnswerCount,
  id: string,
): TierOutcome {
  const current = state.get(id);
  const tier: Tier = current === undefined ? "nudge" : step(current);
  state.set(id, tier);
  if (tier === "answer") return emitAnswer(counts, id);
  return { kind: "tier", tier };
}

/**
 * The `answer` tier for `id`, recorded, so a later plain ask repeats the answer
 * rather than stepping back to the nudge (R4.1, R4.2). Once the answer has been
 * emitted twice, yields `exhausted` instead.
 */
export function answerTier(
  state: TierState,
  counts: AnswerCount,
  id: string,
): TierOutcome {
  state.set(id, "answer");
  return emitAnswer(counts, id);
}
