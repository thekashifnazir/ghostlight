import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Milestone, Pack } from "../packs/tools/src/types.js";
import {
  answerTier,
  nextTier,
  type Tier,
  type TierState,
} from "../src/hints/tiers.js";

// Run against the real pack's milestone ids (R10.5), with no engine or network.
const pack = JSON.parse(
  readFileSync(resolve(__dirname, "../packs/drascula-en.json"), "utf8"),
) as Pack;
const ids = (pack.milestones ?? ([] as Milestone[])).map((m) => m.id);

const ORDER: readonly Tier[] = ["nudge", "clue", "answer"];

/** The expected tier after `count` plain asks on a fresh milestone. */
function expectedAt(count: number): Tier {
  // 1st ask -> nudge (index 0), clamped at answer.
  return ORDER[Math.min(count - 1, ORDER.length - 1)];
}

describe("tier-order property: plain asks are a non-skipping prefix of nudge, clue, answer", () => {
  it("emits nudge, clue, answer then repeated answer, never skipping", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.integer({ min: 1, max: 12 }),
        (id, asks) => {
          const state: TierState = new Map();
          const seen: Tier[] = [];
          for (let i = 0; i < asks; i++) seen.push(nextTier(state, id));

          // The sequence is exactly nudge, clue, answer, answer, ...
          for (let i = 0; i < seen.length; i++) {
            expect(seen[i]).toBe(expectedAt(i + 1));
          }
          // Never skips: each step advances by at most one until clamped.
          for (let i = 1; i < seen.length; i++) {
            const prev = ORDER.indexOf(seen[i - 1]);
            const cur = ORDER.indexOf(seen[i]);
            expect(cur - prev).toBeGreaterThanOrEqual(0);
            expect(cur - prev).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("direct-answer property", () => {
  it("answerTier always yields answer and records it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), (id) => {
        const state: TierState = new Map();
        expect(answerTier(state, id)).toBe("answer");
        // A later plain ask repeats the answer, never stepping back.
        expect(nextTier(state, id)).toBe("answer");
      }),
      { numRuns: 100 },
    );
  });
});
