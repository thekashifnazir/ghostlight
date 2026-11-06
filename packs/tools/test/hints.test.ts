import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadPack } from "../src/load.js";
import { offeredMilestones } from "../src/hints.js";
import type { Pack } from "../src/types.js";
import { arbMilestoneGraph, arbReachedSet } from "./gen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");
const realPack = loadPack(PACK);

function assertNoSpoiler(pack: Pack, reached: Set<string>): void {
  const progress = { chapter: 2, reached };
  const offered = offeredMilestones(pack, progress);
  for (const m of offered) {
    // never offer something already reached
    expect(reached.has(m.id), `offered reached milestone ${m.id}`).toBe(false);
    // never offer something whose prerequisites are not all reached
    for (const dep of m.after ?? []) {
      expect(
        reached.has(dep),
        `offered ${m.id} but prerequisite ${dep} not reached`,
      ).toBe(true);
    }
  }
}

describe("no-spoiler invariant", () => {
  it("over generated graphs and reached sets, never offers an unreachable or done milestone", () => {
    fc.assert(
      fc.property(
        arbMilestoneGraph.chain((milestones) =>
          arbReachedSet(milestones).map((reached) => ({ milestones, reached })),
        ),
        ({ milestones, reached }) => {
          const pack: Pack = {
            format: "scummvm-a11y-pack",
            formatVersion: "1.0",
            game: { engine: "drascula", gameId: "drascula", language: "en" },
            pack: {
              version: "1.0.0",
              updated: "2026-11-06",
              coverage: { chapters: [2] },
            },
            rooms: {
              "14": {
                chapters: [2],
                name: "R",
                short: "s",
                long: "l",
                seen: false,
                exits: {},
                objects: {},
              },
            },
            milestones,
          };
          assertNoSpoiler(pack, reached);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("holds for the real Drascula pack over generated reached sets", () => {
    const milestones = realPack.milestones ?? [];
    fc.assert(
      fc.property(arbReachedSet(milestones), (reached) => {
        assertNoSpoiler(realPack, reached);
      }),
      { numRuns: 200 },
    );
  });
});
