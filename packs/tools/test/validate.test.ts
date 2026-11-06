import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadPack, loadSchema } from "../src/load.js";
import { validateCrossRefs, validatePack } from "../src/validate.js";
import type { Condition, Milestone, Pack } from "../src/types.js";
import { arbMalformedPack, arbValidCondition } from "./gen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = resolve(HERE, "..", "..", "drascula-en.json");
const SCHEMA = resolve(HERE, "..", "..", "schema.json");

const realPack = loadPack(PACK);
const schema = loadSchema(SCHEMA);

describe("validator: the real pack", () => {
  it("validates clean (schema + cross-reference)", () => {
    const result = validatePack(realPack, schema);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("validator: known-bad packs fail", () => {
  it("rejects every deliberately malformed pack, with a relevant error", () => {
    fc.assert(
      fc.property(arbMalformedPack, ({ kind, pack }) => {
        const result = validatePack(pack, schema);
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        // the error list should mention something tied to the defect kind
        const text = result.errors.map((e) => `${e.path} ${e.message}`).join("\n");
        switch (kind) {
          case "out-of-range-flag":
            expect(text).toMatch(/flag index/i);
            break;
          case "missing-hint-tier":
            expect(text).toMatch(/answer|required|hints/i);
            break;
          case "both-when-and-end":
            expect(text).toMatch(/when|end|oneOf|match exactly one/i);
            break;
          case "cyclic-after":
            expect(text).toMatch(/cycle/i);
            break;
          case "dangling-after":
            expect(text).toMatch(/unknown prerequisite|ch2\.ghost/i);
            break;
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("real-flags invariant (R6)", () => {
  // Walk every condition in the real pack and assert flag indices are in range
  // for the milestone's chapter.
  function collectFlags(cond: Condition, out: number[]): void {
    if (cond.flags) for (const k of Object.keys(cond.flags)) out.push(Number(k));
    cond.all?.forEach((c) => collectFlags(c, out));
    cond.any?.forEach((c) => collectFlags(c, out));
    if (cond.not) collectFlags(cond.not, out);
  }

  it("every milestone condition flag is 0 to 49", () => {
    const milestones: Milestone[] = realPack.milestones ?? [];
    for (const m of milestones) {
      if (!m.when) continue;
      const flags: number[] = [];
      collectFlags(m.when, flags);
      for (const f of flags) {
        expect(f, `milestone ${m.id} flag ${f}`).toBeGreaterThanOrEqual(0);
        expect(f, `milestone ${m.id} flag ${f}`).toBeLessThanOrEqual(49);
      }
    }
  });

  it("accepts any generated in-range condition and rejects out-of-range ones", () => {
    fc.assert(
      fc.property(arbValidCondition, (cond) => {
        const pack: Pack = {
          format: "scummvm-a11y-pack",
          formatVersion: "1.0",
          game: { engine: "drascula", gameId: "drascula", language: "en" },
          pack: { version: "1.0.0", updated: "2026-11-06", coverage: { chapters: [2] } },
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
          milestones: [
            {
              id: "ch2.x",
              chapter: 2,
              title: "X",
              when: cond,
              recap: "r",
              hints: { nudge: "n", clue: "c", answer: "a" },
            },
          ],
        };
        const flagErrors = validateCrossRefs(pack).filter((e) =>
          /flag index/.test(e.message),
        );
        expect(flagErrors).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
