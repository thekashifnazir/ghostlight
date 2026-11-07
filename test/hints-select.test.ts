import { describe, expect, it } from "vitest";
import type { Milestone, Pack } from "../packs/tools/src/types.js";
import { selectTarget } from "../src/hints/select.js";

function m(partial: Partial<Milestone> & { id: string }): Milestone {
  return {
    chapter: 2,
    title: partial.id,
    recap: "",
    hints: { nudge: "", clue: "", answer: "" },
    ...partial,
  } as Milestone;
}

function packOf(milestones: Milestone[]): Pack {
  return { milestones } as unknown as Pack;
}

const noneReached = { chapter: 2, reached: new Set<string>() };

describe("selectTarget", () => {
  it("returns undefined when nothing is offered", () => {
    // Every milestone reached -> offered set empty.
    const pack = packOf([m({ id: "a" }), m({ id: "b" })]);
    const progress = { chapter: 2, reached: new Set(["a", "b"]) };
    expect(selectTarget(pack, progress, 14)).toBeUndefined();
  });

  it("prefers an offered milestone whose rooms include the current room", () => {
    const pack = packOf([
      m({ id: "elsewhere", rooms: [99] }),
      m({ id: "here", rooms: [14] }),
    ]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("here");
  });

  it("deprioritises optional milestones (required over optional)", () => {
    const pack = packOf([
      m({ id: "optional-one", optional: true }),
      m({ id: "required-one" }),
    ]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("required-one");
  });

  it("room preference beats required-over-optional", () => {
    // A required milestone not in the room vs an optional one in the room:
    // room preference wins, so the in-room optional is chosen.
    const pack = packOf([
      m({ id: "required-elsewhere", rooms: [99] }),
      m({ id: "optional-here", optional: true, rooms: [14] }),
    ]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("optional-here");
  });

  it("breaks remaining ties by file order", () => {
    const pack = packOf([
      m({ id: "first", rooms: [14] }),
      m({ id: "second", rooms: [14] }),
    ]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("first");
  });

  it("falls back to file order when no milestone lists the current room", () => {
    const pack = packOf([m({ id: "a" }), m({ id: "b" })]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("a");
  });

  it("ignores an offered milestone from a chapter already passed", () => {
    // A ch1 milestone that never latched (session began in ch2) stays offered,
    // but the player has moved past chapter 1, so it must not be the target.
    const pack = packOf([
      m({ id: "ch1.start", chapter: 1 }),
      m({ id: "ch2.handbag", chapter: 2, rooms: [14] }),
    ]);
    const progress = { chapter: 2, reached: new Set<string>() };
    expect(selectTarget(pack, progress, 14)?.id).toBe("ch2.handbag");
  });

  it("returns undefined when the only offered milestones are from a passed chapter", () => {
    const pack = packOf([m({ id: "ch1.start", chapter: 1 })]);
    const progress = { chapter: 2, reached: new Set<string>() };
    expect(selectTarget(pack, progress, 14)).toBeUndefined();
  });

  it("never selects a milestone outside the offered set", () => {
    // `after` gates `b` until `a` is reached; with nothing reached only `a`
    // is offered, so `b` (ahead of the player) must never be chosen.
    const pack = packOf([
      m({ id: "a" }),
      m({ id: "b", after: ["a"], rooms: [14] }),
    ]);
    expect(selectTarget(pack, noneReached, 14)?.id).toBe("a");
  });
});
