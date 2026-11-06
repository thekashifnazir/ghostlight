import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { offeredMilestones } from "../packs/tools/src/hints.js";
import type { Milestone, Pack } from "../packs/tools/src/types.js";
import { selectTarget } from "../src/hints/select.js";

// The real pack's milestones drive the property (R10.5): no live engine, no
// network, just the committed pack read from disk.
const pack = JSON.parse(
  readFileSync(resolve(__dirname, "../packs/drascula-en.json"), "utf8"),
) as Pack;
const milestones: Milestone[] = pack.milestones ?? [];
const ids = milestones.map((m) => m.id);
const byId = new Map(milestones.map((m) => [m.id, m]));

/** Close a set of ids under `after`: adding a milestone pulls in its prereqs. */
function closeUnderAfter(seed: Set<string>): Set<string> {
  const out = new Set(seed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...out]) {
      for (const dep of byId.get(id)?.after ?? []) {
        if (!out.has(dep)) {
          out.add(dep);
          changed = true;
        }
      }
    }
  }
  return out;
}

/** All rooms any milestone lists, plus some that none lists, for coverage. */
const roomArb = fc.constantFrom(
  ...new Set([0, 62, 63, 14, 16, 15, 9, 10, 3, 5, 6, 7, 8, 2, 17, 18, 19, 4, 99]),
);

/** A reachable progress state: a chapter and an after-closed reached subset. */
const progressArb = fc.record({
  chapter: fc.constantFrom(1, 2, 3),
  reachedSeed: fc.subarray(ids),
});

describe("no-spoiler property: selectTarget never picks a milestone ahead of the player", () => {
  it("the defined result is always in offeredMilestones(...)", () => {
    fc.assert(
      fc.property(progressArb, roomArb, ({ chapter, reachedSeed }, room) => {
        const reached = closeUnderAfter(new Set(reachedSeed));
        const progress = { chapter, reached };
        const target = selectTarget(pack, progress, room);
        if (target === undefined) return; // nothing offered is allowed
        const offered = offeredMilestones(pack, progress);
        // The target is one of the offered milestones: not reached, and every
        // `after` prerequisite reached.
        expect(offered.some((m) => m.id === target.id)).toBe(true);
        expect(reached.has(target.id)).toBe(false);
        for (const dep of target.after ?? []) {
          expect(reached.has(dep)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
