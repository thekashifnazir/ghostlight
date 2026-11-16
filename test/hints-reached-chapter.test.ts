import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { satisfiedMilestones } from "../src/hints/reached.js";
import type { Pack } from "../packs/tools/src/types.js";

// packs/FORMAT.md: a milestone's `when` is evaluated only while the current
// chapter is the milestone's chapter. 16 Nov walkthrough: chapter 5 ends with
// flags 0-4, 6-9, 13 and 14 set, which also match chapter 6's flag conditions.
const pack = JSON.parse(readFileSync("packs/drascula-en.json", "utf8")) as Pack;

describe("satisfiedMilestones only counts the current chapter", () => {
  const flags = new Array(50).fill(0);
  for (const f of [0, 1, 2, 3, 4, 6, 7, 8, 9, 13, 14]) flags[f] = 1;

  it("chapter 5's end flags don't mark any chapter 6 step", () => {
    const got = satisfiedMilestones(pack, { chapter: 5, room: 56, flags, inventory: [9, 20] }, new Set());
    expect([...got].filter((id) => id.startsWith("ch6."))).toEqual([]);
    expect([...got].every((id) => id.startsWith("ch5."))).toBe(true);
  });

  it("the same flags in chapter 6 do mark chapter 6 steps", () => {
    const got = satisfiedMilestones(pack, { chapter: 6, room: 102, flags, inventory: [] }, new Set());
    expect(got.has("ch6.free")).toBe(true);
  });
});
