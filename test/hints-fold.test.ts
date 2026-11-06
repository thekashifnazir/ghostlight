import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { foldDiff, type EngineHintState } from "../src/hints/fold.js";

/** A baseline complete state: 50 zeroed flags, two items, chapter 2, room 14. */
function baseState(): EngineHintState {
  return {
    chapter: 2,
    room: 14,
    flags: new Array(50).fill(0),
    inventory: [7, 10],
  };
}

/** A minimal diff with only the fields a case needs. */
function diff(partial: Partial<Diff>): Diff {
  return { cmd: "test", changed: true, ...partial };
}

describe("foldDiff", () => {
  it("lands changed flags on the right indices, leaving the rest unchanged", () => {
    const prev = baseState();
    prev.flags[5] = 1; // a pre-existing flag that must survive
    const next = foldDiff(prev, diff({ flags: { "20": [0, 1], "23": [0, 1] } }));

    expect(next.flags[20]).toBe(1);
    expect(next.flags[23]).toBe(1);
    expect(next.flags[5]).toBe(1); // untouched
    expect(next.flags[0]).toBe(0); // untouched
    expect(next.flags).toHaveLength(50);
  });

  it("takes the diff's `to` value even when a flag goes back to zero", () => {
    const prev = baseState();
    prev.flags[12] = 1;
    const next = foldDiff(prev, diff({ flags: { "12": [1, 0] } }));
    expect(next.flags[12]).toBe(0);
  });

  it("adds invAdded ids and removes invRemoved ids", () => {
    const prev = baseState();
    const next = foldDiff(
      prev,
      diff({
        invAdded: [{ id: 14, name: "sickle" }],
        invRemoved: [{ id: 7, name: "coins" }],
      }),
    );
    expect(next.inventory).toContain(14);
    expect(next.inventory).toContain(10);
    expect(next.inventory).not.toContain(7);
  });

  it("does not duplicate an item already carried", () => {
    const prev = baseState();
    const next = foldDiff(prev, diff({ invAdded: [{ id: 10, name: "dup" }] }));
    expect(next.inventory.filter((id) => id === 10)).toHaveLength(1);
  });

  it("updates chapter and room from a change", () => {
    const prev = baseState();
    const next = foldDiff(prev, diff({ chapter: [2, 3], room: [14, 16] }));
    expect(next.chapter).toBe(3);
    expect(next.room).toBe(16);
  });

  it("keeps the previous chapter and room when the diff carries no change", () => {
    const prev = baseState();
    const next = foldDiff(prev, diff({ flags: { "1": [0, 1] } }));
    expect(next.chapter).toBe(2);
    expect(next.room).toBe(14);
  });

  it("does not mutate the previous state", () => {
    const prev = baseState();
    const prevFlagsRef = prev.flags;
    const prevInvRef = prev.inventory;
    const snapshotFlags = prev.flags.slice();
    const snapshotInv = prev.inventory.slice();

    foldDiff(
      prev,
      diff({
        flags: { "20": [0, 1] },
        invAdded: [{ id: 99, name: "x" }],
        invRemoved: [{ id: 7, name: "y" }],
        chapter: [2, 3],
        room: [14, 16],
      }),
    );

    expect(prev.flags).toBe(prevFlagsRef);
    expect(prev.inventory).toBe(prevInvRef);
    expect(prev.flags).toEqual(snapshotFlags);
    expect(prev.inventory).toEqual(snapshotInv);
    expect(prev.chapter).toBe(2);
    expect(prev.room).toBe(14);
  });
});
