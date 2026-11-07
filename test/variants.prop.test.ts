// Property-based proof of single description selection
// (description-variants spec, Requirement 8).
//
// For any complete engine state and reached set, resolveDescription must yield
// exactly one string: never zero, never more than one. When no variant matches
// it falls back to the default; a plain string resolves to itself; and when
// several variants could match, the earliest in document order wins.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition } from "../packs/tools/src/types.js";
import type { EngineHintState } from "../src/hints/fold.js";
import {
  resolveDescription,
  type Describable,
  type VariantList,
} from "../src/model/variants.js";

/** An arbitrary complete engine state: chapter, room, 50 flags, inventory. */
const arbState: fc.Arbitrary<EngineHintState> = fc.record({
  chapter: fc.integer({ min: 0, max: 6 }),
  room: fc.integer({ min: 0, max: 120 }),
  flags: fc.array(fc.integer({ min: 0, max: 3 }), {
    minLength: 50,
    maxLength: 50,
  }),
  inventory: fc.uniqueArray(fc.integer({ min: 0, max: 60 }), { maxLength: 10 }),
});

/** An arbitrary reached milestone set. */
const arbReached: fc.Arbitrary<ReadonlySet<string>> = fc
  .uniqueArray(
    fc.constantFrom("ch1.start", "ch2.start", "ch2.church", "ch2.money"),
    { maxLength: 4 },
  )
  .map((ids) => new Set(ids));

/** An arbitrary variant keyed on a single flag index/value (easy to reason about). */
const arbFlagVariant: fc.Arbitrary<{ when: Condition; text: string }> = fc.record(
  {
    index: fc.integer({ min: 0, max: 49 }),
    value: fc.integer({ min: 1, max: 3 }),
    text: fc.string({ minLength: 1, maxLength: 20 }),
  },
).map(({ index, value, text }) => ({
  when: { flags: { [String(index)]: value } },
  text,
}));

/** An arbitrary object-form description with a default and some variants. */
const arbVariantList: fc.Arbitrary<VariantList> = fc.record({
  default: fc.string({ minLength: 1, maxLength: 20 }),
  variants: fc.array(arbFlagVariant, { minLength: 1, maxLength: 5 }),
});

describe("resolveDescription — single selection (R8.1)", () => {
  it("returns exactly one string, always one of the variant texts or the default", () => {
    fc.assert(
      fc.property(arbVariantList, arbState, arbReached, (desc, state, reached) => {
        const out = resolveDescription(desc, state, reached);
        expect(typeof out).toBe("string");
        const legal = new Set([desc.default, ...desc.variants.map((v) => v.text)]);
        expect(legal.has(out)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("resolveDescription — default on no match (R8.2)", () => {
  it("falls back to the default when no variant condition holds", () => {
    // Variants key on flag values 1..3; a state with all flags 0 matches none.
    const zeroFlags: EngineHintState = {
      chapter: 2,
      room: 5,
      flags: new Array(50).fill(0),
      inventory: [],
    };
    fc.assert(
      fc.property(arbVariantList, arbReached, (desc, reached) => {
        expect(resolveDescription(desc, zeroFlags, reached)).toBe(desc.default);
      }),
      { numRuns: 200 },
    );
  });
});

describe("resolveDescription — plain string (R8.3)", () => {
  it("a plain-string description resolves to itself for any state", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        arbState,
        arbReached,
        (s, state, reached) => {
          expect(resolveDescription(s as Describable, state, reached)).toBe(s);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("resolveDescription — first match wins (R8.4)", () => {
  it("returns the earliest matching variant when several conditions hold", () => {
    // Build two variants that both always hold for the generated state, plus a
    // trailing always-true one, and assert the first is chosen.
    fc.assert(
      fc.property(
        arbState,
        arbReached,
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (state, reached, firstText, secondText) => {
          const alwaysTrue1: Condition = { chapter: state.chapter };
          const alwaysTrue2: Condition = { room: state.room };
          const desc: VariantList = {
            default: "DEFAULT",
            variants: [
              { when: alwaysTrue1, text: firstText },
              { when: alwaysTrue2, text: secondText },
            ],
          };
          expect(resolveDescription(desc, state, reached)).toBe(firstText);
        },
      ),
      { numRuns: 200 },
    );
  });
});
