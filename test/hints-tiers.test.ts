import { describe, expect, it } from "vitest";
import {
  answerTier,
  nextTier,
  type TierState,
} from "../src/hints/tiers.js";

describe("nextTier", () => {
  it("steps nudge -> clue -> answer -> answer on repeated asks", () => {
    const state: TierState = new Map();
    expect(nextTier(state, "m")).toBe("nudge");
    expect(nextTier(state, "m")).toBe("clue");
    expect(nextTier(state, "m")).toBe("answer");
    expect(nextTier(state, "m")).toBe("answer"); // clamped
    expect(nextTier(state, "m")).toBe("answer");
  });

  it("never skips a tier", () => {
    const state: TierState = new Map();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) seen.push(nextTier(state, "m"));
    expect(seen).toEqual(["nudge", "clue", "answer", "answer", "answer"]);
  });

  it("tracks tiers per milestone id independently", () => {
    const state: TierState = new Map();
    expect(nextTier(state, "a")).toBe("nudge");
    expect(nextTier(state, "a")).toBe("clue");
    // A different milestone starts fresh at its own nudge.
    expect(nextTier(state, "b")).toBe("nudge");
    // Returning to `a` continues from its own tier.
    expect(nextTier(state, "a")).toBe("answer");
  });
});

describe("answerTier", () => {
  it("returns answer directly and records it", () => {
    const state: TierState = new Map();
    expect(answerTier(state, "m")).toBe("answer");
    // A later plain ask repeats the answer, not a step back to nudge.
    expect(nextTier(state, "m")).toBe("answer");
  });

  it("is independent per milestone", () => {
    const state: TierState = new Map();
    answerTier(state, "a");
    // `b` is untouched and still starts at nudge.
    expect(nextTier(state, "b")).toBe("nudge");
    expect(nextTier(state, "a")).toBe("answer");
  });
});
