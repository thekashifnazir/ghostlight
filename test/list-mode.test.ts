import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { ListMode } from "../src/ui/list-mode.js";

function mkList(names: string[]): Hotspot[] {
  return names.map((name, i) => ({
    num: i + 1,
    kind: "object" as const,
    name,
    rect: [i * 10, 0, 5, 5] as [number, number, number, number],
    walkTo: [0, 0] as [number, number],
  }));
}

/** A ListMode with a captured announce log. */
function mk(names: string[]) {
  const announced: string[] = [];
  const focused: (string | undefined)[] = [];
  const lm = new ListMode(
    (t) => announced.push(t),
    (h) => focused.push(h?.name),
  );
  lm.rebuild(mkList(names));
  return { lm, announced, focused };
}

describe("ListMode", () => {
  it("rebuild focuses the first hotspot", () => {
    const { lm } = mk(["a", "b", "c"]);
    expect(lm.current()?.name).toBe("a");
    expect(lm.focusedIndex()).toBe(0);
  });

  it("next and prev move with wrap and announce N of M", () => {
    const { lm, announced } = mk(["a", "b", "c"]);
    lm.next();
    expect(lm.current()?.name).toBe("b");
    expect(announced.at(-1)).toBe("b, 2 of 3");
    lm.next();
    lm.next(); // wrap from c back to a
    expect(lm.current()?.name).toBe("a");
    expect(announced.at(-1)).toBe("a, 1 of 3");
    lm.prev(); // wrap from a back to c
    expect(lm.current()?.name).toBe("c");
    expect(announced.at(-1)).toBe("c, 3 of 3");
  });

  it("has no focus when empty and does not move", () => {
    const { lm } = mk([]);
    expect(lm.current()).toBeUndefined();
    expect(lm.focusedIndex()).toBe(-1);
    lm.next();
    lm.prev();
    expect(lm.current()).toBeUndefined();
  });

  it("update keeps focus on the same hotspot number when it survives", () => {
    const { lm } = mk(["a", "b", "c"]);
    lm.next(); // focus b (num 2)
    // Remove a; b and c survive with the same nums.
    lm.update([
      { num: 2, kind: "object", name: "b", rect: [10, 0, 5, 5], walkTo: [0, 0] },
      { num: 3, kind: "object", name: "c", rect: [20, 0, 5, 5], walkTo: [0, 0] },
    ]);
    expect(lm.current()?.num).toBe(2);
  });

  it("update clamps to first when the focused hotspot is gone", () => {
    const { lm } = mk(["a", "b"]);
    lm.next(); // focus b (num 2)
    lm.update([
      { num: 1, kind: "object", name: "a", rect: [0, 0, 5, 5], walkTo: [0, 0] },
    ]);
    expect(lm.current()?.num).toBe(1);
  });

  it("property: rebuild leaves exactly one in-range focus for any non-empty list", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
        (names) => {
          const { lm } = mk(names);
          const idx = lm.focusedIndex();
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(names.length);
          expect(lm.current()).toBeDefined();
        },
      ),
    );
  });

  it("property: cycling all the way round returns to the start", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 20 }),
        (names) => {
          const { lm } = mk(names);
          const start = lm.focusedIndex();
          for (let i = 0; i < names.length; i++) lm.next();
          expect(lm.focusedIndex()).toBe(start);
        },
      ),
    );
  });
});
