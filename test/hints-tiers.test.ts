import { describe, expect, it } from "vitest";
import {
  answerTier,
  nextTier,
  type AnswerCount,
  type TierOutcome,
  type TierState,
} from "../src/hints/tiers.js";

/** A fresh tier state and answer-count pair. */
function fresh(): { state: TierState; counts: AnswerCount } {
  return { state: new Map(), counts: new Map() };
}

/** The tier of an outcome, failing if it was exhausted. */
function tier(o: TierOutcome): string {
  if (o.kind !== "tier") throw new Error("expected a tier, got exhausted");
  return o.tier;
}

describe("nextTier", () => {
  it("steps nudge -> clue -> answer, repeats answer once, then exhausts", () => {
    const { state, counts } = fresh();
    expect(tier(nextTier(state, counts, "m"))).toBe("nudge");
    expect(tier(nextTier(state, counts, "m"))).toBe("clue");
    expect(tier(nextTier(state, counts, "m"))).toBe("answer"); // 1st answer
    expect(tier(nextTier(state, counts, "m"))).toBe("answer"); // 2nd answer
    // After the answer has been given twice, the ghost is exhausted.
    expect(nextTier(state, counts, "m")).toEqual({ kind: "exhausted" });
    expect(nextTier(state, counts, "m")).toEqual({ kind: "exhausted" });
  });

  it("never skips a tier before exhausting", () => {
    const { state, counts } = fresh();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const o = nextTier(state, counts, "m");
      seen.push(o.kind === "exhausted" ? "exhausted" : o.tier);
    }
    expect(seen).toEqual([
      "nudge",
      "clue",
      "answer",
      "answer",
      "exhausted",
      "exhausted",
    ]);
  });

  it("tracks tiers per milestone id independently", () => {
    const { state, counts } = fresh();
    expect(tier(nextTier(state, counts, "a"))).toBe("nudge");
    expect(tier(nextTier(state, counts, "a"))).toBe("clue");
    // A different milestone starts fresh at its own nudge.
    expect(tier(nextTier(state, counts, "b"))).toBe("nudge");
    // Returning to `a` continues from its own tier.
    expect(tier(nextTier(state, counts, "a"))).toBe("answer");
  });

  it("exhaustion is independent per milestone", () => {
    const { state, counts } = fresh();
    // Exhaust `a` entirely.
    nextTier(state, counts, "a"); // nudge
    nextTier(state, counts, "a"); // clue
    nextTier(state, counts, "a"); // answer 1
    nextTier(state, counts, "a"); // answer 2
    expect(nextTier(state, counts, "a")).toEqual({ kind: "exhausted" });
    // `b` is untouched and still starts at nudge.
    expect(tier(nextTier(state, counts, "b"))).toBe("nudge");
  });
});

describe("answerTier", () => {
  it("returns answer twice then exhausts", () => {
    const { state, counts } = fresh();
    expect(tier(answerTier(state, counts, "m"))).toBe("answer"); // 1st
    expect(tier(answerTier(state, counts, "m"))).toBe("answer"); // 2nd
    expect(answerTier(state, counts, "m")).toEqual({ kind: "exhausted" });
  });

  it("a later plain ask repeats the answer, then exhausts", () => {
    const { state, counts } = fresh();
    expect(tier(answerTier(state, counts, "m"))).toBe("answer"); // 1st answer
    // A later plain ask repeats the answer, not a step back to nudge.
    expect(tier(nextTier(state, counts, "m"))).toBe("answer"); // 2nd answer
    // The third answer emission is exhausted.
    expect(nextTier(state, counts, "m")).toEqual({ kind: "exhausted" });
  });

  it("counts answer emissions across both paths", () => {
    const { state, counts } = fresh();
    // One answer via nextTier (clamped), one via answerTier, then exhausted.
    nextTier(state, counts, "m"); // nudge
    nextTier(state, counts, "m"); // clue
    expect(tier(nextTier(state, counts, "m"))).toBe("answer"); // 1st answer
    expect(tier(answerTier(state, counts, "m"))).toBe("answer"); // 2nd answer
    // The third answer emission, by either path, is exhausted.
    expect(answerTier(state, counts, "m")).toEqual({ kind: "exhausted" });
  });

  it("is independent per milestone", () => {
    const { state, counts } = fresh();
    answerTier(state, counts, "a");
    // `b` is untouched and still starts at nudge.
    expect(tier(nextTier(state, counts, "b"))).toBe("nudge");
    expect(tier(nextTier(state, counts, "a"))).toBe("answer");
  });
});
