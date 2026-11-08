import { describe, expect, it } from "vitest";
import { answerTier, nextTier, type TierState } from "../src/hints/tiers.js";

/** A fresh tier state. */
function fresh(): TierState {
  return new Map();
}

describe("nextTier", () => {
  it("steps nudge -> clue -> answer, then repeats answer forever", () => {
    const state = fresh();
    expect(nextTier(state, "m")).toBe("nudge");
    expect(nextTier(state, "m")).toBe("clue");
    expect(nextTier(state, "m")).toBe("answer"); // 1st answer
    // Every further ask repeats the answer; the ghost never cuts the player off.
    expect(nextTier(state, "m")).toBe("answer");
    expect(nextTier(state, "m")).toBe("answer");
    expect(nextTier(state, "m")).toBe("answer");
  });

  it("never skips a tier and clamps at answer", () => {
    const state = fresh();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) seen.push(nextTier(state, "m"));
    expect(seen).toEqual(["nudge", "clue", "answer", "answer", "answer", "answer"]);
  });

  it("tracks tiers per milestone id independently", () => {
    const state = fresh();
    expect(nextTier(state, "a")).toBe("nudge");
    expect(nextTier(state, "a")).toBe("clue");
    // A different milestone starts fresh at its own nudge.
    expect(nextTier(state, "b")).toBe("nudge");
    // Returning to `a` continues from its own tier.
    expect(nextTier(state, "a")).toBe("answer");
  });

  it("the answer-repeats behaviour is independent per milestone", () => {
    const state = fresh();
    // Drive `a` to answer and keep asking.
    nextTier(state, "a"); // nudge
    nextTier(state, "a"); // clue
    expect(nextTier(state, "a")).toBe("answer");
    expect(nextTier(state, "a")).toBe("answer");
    // `b` is untouched and still starts at nudge.
    expect(nextTier(state, "b")).toBe("nudge");
  });
});

describe("answerTier", () => {
  it("returns answer every time it is asked", () => {
    const state = fresh();
    expect(answerTier(state, "m")).toBe("answer");
    expect(answerTier(state, "m")).toBe("answer");
    expect(answerTier(state, "m")).toBe("answer");
  });

  it("a later plain ask repeats the answer, never stepping back", () => {
    const state = fresh();
    expect(answerTier(state, "m")).toBe("answer"); // direct answer
    // A later plain ask repeats the answer, not a step back to nudge.
    expect(nextTier(state, "m")).toBe("answer");
    // And it keeps repeating the answer.
    expect(nextTier(state, "m")).toBe("answer");
  });

  it("is independent per milestone", () => {
    const state = fresh();
    answerTier(state, "a");
    // `b` is untouched and still starts at nudge.
    expect(nextTier(state, "b")).toBe("nudge");
    expect(nextTier(state, "a")).toBe("answer");
  });
});
