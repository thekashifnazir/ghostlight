// Tier progression (Requirements 3, 4). Pure over plain data.
//
// Tier state is a `Map<string, Tier>` keyed by milestone id and owned by the
// caller, so each milestone progresses independently and returning to an
// earlier milestone continues from its own tier (R3.6). "Reset on target
// change" (R3.5) is implicit: a new milestone id has no recorded tier, so
// `nextTier` returns `nudge`. No DOM, engine or network dependency.
//
// Once the answer tier is reached it is the terminal tier: every further plain
// ask (or direct-answer ask) returns the answer again, so a player who keeps
// pressing the hint key keeps hearing the answer rather than being cut off
// (R3.3, R4.2). There is no "exhausted" state — the ghost always repeats the
// answer it has already given.

export type Tier = "nudge" | "clue" | "answer";

export type TierState = Map<string, Tier>;

const ORDER: readonly Tier[] = ["nudge", "clue", "answer"];

/** The tier after `t`, clamped at `answer`. */
function step(t: Tier): Tier {
  const i = ORDER.indexOf(t);
  return ORDER[Math.min(i + 1, ORDER.length - 1)];
}

/**
 * The next tier for `id` on a plain ask. A milestone with no recorded tier
 * starts at `nudge` (R3.1); otherwise step up one tier, clamped at `answer`
 * (R3.2, R3.3). Never skips a tier (R3.4). Records the returned tier in `state`.
 * Once at `answer`, every further ask returns `answer` again (R3.3).
 */
export function nextTier(state: TierState, id: string): Tier {
  const current = state.get(id);
  const tier: Tier = current === undefined ? "nudge" : step(current);
  state.set(id, tier);
  return tier;
}

/**
 * The `answer` tier for `id`, recorded, so a later plain ask repeats the answer
 * rather than stepping back to the nudge (R4.1, R4.2). Always returns `answer`;
 * asking for the answer again simply gives the answer again.
 */
export function answerTier(state: TierState, id: string): Tier {
  state.set(id, "answer");
  return "answer";
}
