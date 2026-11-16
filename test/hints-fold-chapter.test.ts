import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { foldDiff } from "../src/hints/fold.js";

// 16 Nov walkthrough: chapter 5 ends with flags 0-4, 6-9, 13 and 14 set. The
// crossing diff into chapter 6 lists no flag resets, so the old flags must not
// carry over (they made chapter 6's hints skip to the bar).
describe("foldDiff across a chapter change", () => {
  const ch5End = () => {
    const flags = new Array(50).fill(0);
    for (const f of [0, 1, 2, 3, 4, 6, 7, 8, 9, 13, 14]) flags[f] = 1;
    return { chapter: 5, room: 56, flags, inventory: [9, 20] };
  };
  const d = (p: Partial<Diff>): Diff => ({ cmd: "open 124", changed: true, ...p });

  it("clears the old chapter's flags, then applies the new chapter's", () => {
    const next = foldDiff(ch5End(), d({ chapter: [5, 6], room: [56, 102], flags: { "3": [0, 1] } }));
    expect(next.chapter).toBe(6);
    expect(next.flags.filter((v) => v === 1).length).toBe(1);
    expect(next.flags[3]).toBe(1);
    expect(next.flags[2]).toBe(0);
    expect(next.flags).toHaveLength(50);
    expect(next.inventory).toEqual([9, 20]); // inventory is the engine's, not reset
  });

  it("keeps flags on a room change within a chapter", () => {
    const next = foldDiff(ch5End(), d({ room: [56, 57] }));
    expect(next.flags[2]).toBe(1);
  });

  it("a diff that repeats the current chapter doesn't clear anything", () => {
    const next = foldDiff(ch5End(), d({ chapter: [5, 5] }));
    expect(next.flags[2]).toBe(1);
  });
});
