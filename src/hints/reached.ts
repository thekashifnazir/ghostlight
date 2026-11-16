// Reached-set derivation (Requirement 1.1, 1.2). Pure.
//
// Evaluates each milestone's `when` condition against a complete engine state
// and returns the ids whose condition holds now. Latching is the tracker's job
// (progress.ts); this function is stateless and reports only what is satisfied
// at this instant.
//
// The condition evaluator mirrors the pack's documented `Condition` semantics
// exactly: `chapter` equality; `room` equality or membership; `flags` map (each
// index equals the given value); `has` (all ids present); `lacks` (none
// present); the `all`/`any`/`not` combinators; and `milestone` (that id is in
// the reached set). A condition with several keys is an AND of them.

import type { Condition, Milestone, Pack } from "../../packs/tools/src/types.js";
import type { EngineHintState } from "./fold.js";

/** Evaluate one condition against the state and the current reached set. */
export function evaluate(
  cond: Condition,
  state: EngineHintState,
  reached: ReadonlySet<string>,
): boolean {
  // Combinators.
  if (cond.all !== undefined) {
    if (!cond.all.every((c) => evaluate(c, state, reached))) return false;
  }
  if (cond.any !== undefined) {
    if (!cond.any.some((c) => evaluate(c, state, reached))) return false;
  }
  if (cond.not !== undefined) {
    if (evaluate(cond.not, state, reached)) return false;
  }

  // Leaf keys.
  if (cond.chapter !== undefined && state.chapter !== cond.chapter) {
    return false;
  }
  if (cond.room !== undefined) {
    const rooms = Array.isArray(cond.room) ? cond.room : [cond.room];
    if (!rooms.includes(state.room)) return false;
  }
  if (cond.flags !== undefined) {
    for (const [index, value] of Object.entries(cond.flags)) {
      if (state.flags[Number(index)] !== value) return false;
    }
  }
  if (cond.has !== undefined) {
    if (!cond.has.every((id) => state.inventory.includes(id))) return false;
  }
  if (cond.lacks !== undefined) {
    if (cond.lacks.some((id) => state.inventory.includes(id))) return false;
  }
  if (cond.milestone !== undefined) {
    if (!reached.has(cond.milestone)) return false;
  }

  // An empty condition object (no keys) holds vacuously; the combinators and
  // leaves above have each returned false on any failure.
  return true;
}

/**
 * The milestone ids whose `when` condition holds against `state` right now. A
 * milestone without a `when` is never satisfied by condition (it is reached by
 * other means, e.g. a chapter end), so it is excluded here.
 */
export function satisfiedMilestones(
  pack: Pack,
  state: EngineHintState,
  reached: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const m of pack.milestones ?? ([] as Milestone[])) {
    if (m.when === undefined) continue;
    // `when` is evaluated only while the current chapter is the milestone's
    // chapter (packs/FORMAT.md). Drascula reuses flag numbers in every
    // chapter, so without this, chapter 5's flags 2, 6, 7 and 8 marked
    // chapter 6's steps done before chapter 6 began (16 Nov walkthrough).
    if (m.chapter !== state.chapter) continue;
    if (evaluate(m.when, state, reached)) out.add(m.id);
  }
  return out;
}
