import { describe, expect, it } from "vitest";
import type { Condition, Pack } from "../packs/tools/src/types.js";
import { evaluate, satisfiedMilestones } from "../src/hints/reached.js";
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

const NONE: ReadonlySet<string> = new Set();

describe("evaluate — leaf conditions", () => {
  it("chapter equality", () => {
    expect(evaluate({ chapter: 2 }, state({ chapter: 2 }), NONE)).toBe(true);
    expect(evaluate({ chapter: 1 }, state({ chapter: 2 }), NONE)).toBe(false);
  });

  it("room equality and membership", () => {
    expect(evaluate({ room: 14 }, state({ room: 14 }), NONE)).toBe(true);
    expect(evaluate({ room: 14 }, state({ room: 16 }), NONE)).toBe(false);
    expect(evaluate({ room: [14, 16] }, state({ room: 16 }), NONE)).toBe(true);
    expect(evaluate({ room: [14, 16] }, state({ room: 9 }), NONE)).toBe(false);
  });

  it("flags map (each index equals the given value)", () => {
    const s = state();
    s.flags[20] = 1;
    s.flags[23] = 1;
    expect(evaluate({ flags: { "20": 1 } }, s, NONE)).toBe(true);
    expect(evaluate({ flags: { "20": 1, "23": 1 } }, s, NONE)).toBe(true);
    expect(evaluate({ flags: { "20": 1, "21": 1 } }, s, NONE)).toBe(false);
    expect(evaluate({ flags: { "20": 0 } }, s, NONE)).toBe(false);
  });

  it("has (all ids present) and lacks (none present)", () => {
    const s = state({ inventory: [7, 14] });
    expect(evaluate({ has: [14] }, s, NONE)).toBe(true);
    expect(evaluate({ has: [7, 14] }, s, NONE)).toBe(true);
    expect(evaluate({ has: [7, 99] }, s, NONE)).toBe(false);
    expect(evaluate({ lacks: [99] }, s, NONE)).toBe(true);
    expect(evaluate({ lacks: [7] }, s, NONE)).toBe(false);
  });

  it("milestone references the reached set", () => {
    const reached = new Set(["ch2.start"]);
    expect(evaluate({ milestone: "ch2.start" }, state(), reached)).toBe(true);
    expect(evaluate({ milestone: "ch2.handbag" }, state(), reached)).toBe(false);
  });
});

describe("evaluate — combinators and AND of keys", () => {
  it("multiple keys combine as AND", () => {
    const s = state({ chapter: 2, room: 14 });
    s.flags[40] = 1;
    expect(evaluate({ chapter: 2, flags: { "40": 1 } }, s, NONE)).toBe(true);
    expect(evaluate({ chapter: 2, flags: { "40": 0 } }, s, NONE)).toBe(false);
    expect(evaluate({ chapter: 1, flags: { "40": 1 } }, s, NONE)).toBe(false);
  });

  it("all requires every sub-condition", () => {
    const s = state({ chapter: 2, room: 14, inventory: [14] });
    const cond: Condition = { all: [{ chapter: 2 }, { has: [14] }] };
    expect(evaluate(cond, s, NONE)).toBe(true);
    expect(evaluate({ all: [{ chapter: 2 }, { has: [99] }] }, s, NONE)).toBe(false);
  });

  it("any requires at least one sub-condition", () => {
    const s = state({ inventory: [14] });
    const cond: Condition = { any: [{ has: [14] }, { flags: { "37": 1 } }] };
    expect(evaluate(cond, s, NONE)).toBe(true);
    const s2 = state();
    s2.flags[37] = 1;
    expect(evaluate(cond, s2, NONE)).toBe(true);
    expect(evaluate(cond, state(), NONE)).toBe(false);
  });

  it("not inverts its sub-condition", () => {
    expect(evaluate({ not: { chapter: 1 } }, state({ chapter: 2 }), NONE)).toBe(true);
    expect(evaluate({ not: { chapter: 2 } }, state({ chapter: 2 }), NONE)).toBe(false);
  });

  it("nested all/any/not", () => {
    const s = state({ chapter: 2, room: 14, inventory: [14] });
    const cond: Condition = {
      all: [
        { chapter: 2 },
        { any: [{ room: 99 }, { has: [14] }] },
        { not: { flags: { "0": 1 } } },
      ],
    };
    expect(evaluate(cond, s, NONE)).toBe(true);
    const s2 = state({ chapter: 2, room: 14, inventory: [] });
    expect(evaluate(cond, s2, NONE)).toBe(false); // the any fails
  });
});

describe("satisfiedMilestones", () => {
  const pack = {
    milestones: [
      { id: "a", chapter: 2, title: "A", when: { chapter: 2 }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
      { id: "b", chapter: 2, title: "B", when: { flags: { "20": 1 } }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
      { id: "c", chapter: 2, title: "C", recap: "", hints: { nudge: "", clue: "", answer: "" } }, // no when
      { id: "d", chapter: 2, title: "D", when: { milestone: "a" }, recap: "", hints: { nudge: "", clue: "", answer: "" } },
    ],
  } as unknown as Pack;

  it("returns ids whose when holds now, excluding a missing when", () => {
    const s = state({ chapter: 2 });
    const got = satisfiedMilestones(pack, s, NONE);
    expect(got.has("a")).toBe(true); // chapter 2
    expect(got.has("b")).toBe(false); // flag 20 not set
    expect(got.has("c")).toBe(false); // no when, never satisfied by condition
    expect(got.has("d")).toBe(false); // "a" not yet in reached
  });

  it("resolves milestone references against the passed reached set", () => {
    const got = satisfiedMilestones(pack, state({ chapter: 2 }), new Set(["a"]));
    expect(got.has("d")).toBe(true);
  });
});
