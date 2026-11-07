import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Milestone, Pack } from "../packs/tools/src/types.js";
import {
  answerTier,
  nextTier,
  type AnswerCount,
  type Tier,
  type TierState,
} from "../src/hints/tiers.js";

// Run against the real pack's milestone ids (R10.5), with no engine or network.
const pack = JSON.parse(
  readFileSync(resolve(__dirname, "../packs/drascula-en.json"), "utf8"),
) as Pack;
const ids = (pack.milestones ?? ([] as Milestone[])).map((m) => m.id);

const ORDER: readonly Tier[] = ["nudge", "clue", "answer"];

/** The expected outcome label after `count` plain asks on a fresh milestone. */
function expectedAt(count: number): Tier | "exhausted" {
  // 1 -> nudge, 2 -> clue, 3 -> answer, 4 -> answer, 5+ -> exhausted.
  if (count >= 5) return "exhausted";
  return ORDER[Math.min(count - 1, ORDER.length - 1)];
}

describe("tier-order property: plain asks are a non-skipping prefix of nudge, clue, answer", () => {
  it("emits nudge, clue, answer, answer, then exhausted, never skipping", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.integer({ min: 1, max: 12 }),
        (id, asks) => {
          const state: TierState = new Map();
          const counts: AnswerCount = new Map();
          const seen: (Tier | "exhausted")[] = [];
          for (let i = 0; i < asks; i++) {
            const o = nextTier(state, counts, id);
            seen.push(o.kind === "exhausted" ? "exhausted" : o.tier);
          }

          // The sequence is exactly nudge, clue, answer, answer, exhausted, ...
          for (let i = 0; i < seen.length; i++) {
            expect(seen[i]).toBe(expectedAt(i + 1));
          }
          // Tiers never skip: while still a tier, each step advances by at most
          // one until clamped at answer.
          for (let i = 1; i < seen.length; i++) {
            const prevT = seen[i - 1];
            const curT = seen[i];
            if (prevT === "exhausted" || curT === "exhausted") continue;
            const prev = ORDER.indexOf(prevT);
            const cur = ORDER.indexOf(curT);
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
  it("answerTier yields answer twice then exhausts, recording it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ids), (id) => {
        const state: TierState = new Map();
        const counts: AnswerCount = new Map();
        const first = answerTier(state, counts, id);
        expect(first).toEqual({ kind: "tier", tier: "answer" });
        // A later plain ask repeats the answer, never stepping back.
        expect(nextTier(state, counts, id)).toEqual({
          kind: "tier",
          tier: "answer",
        });
        // The third answer emission is exhausted.
        expect(nextTier(state, counts, id)).toEqual({ kind: "exhausted" });
      }),
      { numRuns: 100 },
    );
  });
});
