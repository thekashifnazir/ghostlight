// Description resolution (description-variants spec, Requirement 2).
//
// A pack description (a room's short or long, or an object's description) is
// either a plain string or an object carrying a `default` string and an
// ordered list of condition-guarded `variants`. This module chooses exactly
// one string for a given game state: the first variant whose `when` holds in
// document order, otherwise the `default`. A plain string resolves to itself.
//
// It reuses the one condition evaluator the hint core already uses
// (`evaluate` in src/hints/reached.ts), against the same complete folded state
// (`EngineHintState`) and reached milestone set, so variant and milestone
// semantics never drift apart. Pure: no I/O, no DOM, no mutation.

import type { Condition } from "../../packs/tools/src/types.js";
import type { EngineHintState } from "../hints/fold.js";
import { evaluate } from "../hints/reached.js";

/** One condition-guarded alternative description. */
export interface DescriptionVariant {
  when: Condition;
  text: string;
}

/** A description with a default and ordered, condition-guarded variants. */
export interface VariantList {
  default: string;
  variants: DescriptionVariant[];
}

/** A description field: a plain string, or the default-plus-variants object. */
export type Describable = string | VariantList;

/** Is this description the object (default-plus-variants) form? */
export function isVariantList(d: Describable): d is VariantList {
  return typeof d === "object" && d !== null && "default" in d && "variants" in d;
}

/**
 * Resolve a description to exactly one string for the given state and reached
 * set. A plain string returns itself (no condition is evaluated). Otherwise the
 * first variant whose `when` holds, in document order, is returned; if none
 * holds, the `default` is returned. Always returns one string.
 */
export function resolveDescription(
  d: Describable,
  state: EngineHintState,
  reached: ReadonlySet<string>,
): string {
  if (typeof d === "string") return d;
  for (const v of d.variants) {
    if (evaluate(v.when, state, reached)) return v.text;
  }
  return d.default;
}
