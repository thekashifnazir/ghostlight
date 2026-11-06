import { describe, expect, it } from "vitest";
import type { Pack } from "../packs/tools/src/types.js";
import { ProgressTracker } from "../src/hints/progress.js";
import type { EngineHintState } from "../src/hints/fold.js";

function state(partial: Partial<EngineHintState> = {}): EngineHintState {
  return {
    chapter: 2,
    room: 14,
    flags: new Array(50).fill(0),
    inventory: [],
    ...partial,
  };
}

const pack = {
  milestones: [
    { id: "a", chapter: 2, title: "A", when: { flags: { "20": 1 } }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
    { id: "b", chapter: 2, title: "B", when: { milestone: "a" }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
    { id: "c", chapter: 2, title: "C", when: { milestone: "b" }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
  ],
} as unknown as Pack;

describe("ProgressTracker", () => {
  it("latches a milestone so it stays reached after its when stops holding", () => {
    const t = new ProgressTracker(pack);

    const on = state();
    on.flags[20] = 1;
    t.update(on);
    expect(t.progress().reached.has("a")).toBe(true);

    // The flag clears; `a` must remain reached (latched).
    t.update(state({ flags: new Array(50).fill(0) }));
    expect(t.progress().reached.has("a")).toBe(true);
  });

  it("never shrinks the reached set across updates", () => {
    const t = new ProgressTracker(pack);
    const on = state();
    on.flags[20] = 1;
    t.update(on);
    const size1 = t.progress().reached.size;

    t.update(state()); // nothing satisfied now
    const size2 = t.progress().reached.size;
    expect(size2).toBeGreaterThanOrEqual(size1);
  });

  it("latches a chain of milestone references in a single update (fixed point)", () => {
    const t = new ProgressTracker(pack);
    const on = state();
    on.flags[20] = 1; // satisfies a; b depends on a; c depends on b
    t.update(on);
    const reached = t.progress().reached;
    expect(reached.has("a")).toBe(true);
    expect(reached.has("b")).toBe(true);
    expect(reached.has("c")).toBe(true);
  });

  it("records the current chapter", () => {
    const t = new ProgressTracker(pack);
    t.update(state({ chapter: 3 }));
    expect(t.progress().chapter).toBe(3);
  });
});
