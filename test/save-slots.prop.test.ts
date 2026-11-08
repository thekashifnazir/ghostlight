import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_SLOT,
  MANUAL_SLOT,
  slotForSave,
  type SaveKind,
} from "../src/engine/persistence.js";

describe("autosave never overwrites a manual slot (R6.2, R2.6)", () => {
  it("routes every save of a kind to that kind's reserved slot, and the two never collide", () => {
    const kinds: fc.Arbitrary<SaveKind> = fc.constantFrom("auto", "manual");

    fc.assert(
      fc.property(fc.array(kinds, { maxLength: 100 }), (sequence) => {
        // Replay an arbitrary mix of manual saves and room-change autosaves,
        // recording which slot each write lands on.
        for (const kind of sequence) {
          const slot = slotForSave(kind);
          if (kind === "auto") {
            // An autosave must land on the autosave slot, never on a manual one.
            expect(slot).toBe(AUTOSAVE_SLOT);
            expect(slot).not.toBe(MANUAL_SLOT);
          } else {
            // A manual save must land on the manual slot, never on the autosave.
            expect(slot).toBe(MANUAL_SLOT);
            expect(slot).not.toBe(AUTOSAVE_SLOT);
          }
        }
      }),
    );
  });

  it("the autosave and manual slot numbers are disjoint by construction", () => {
    expect(slotForSave("auto")).not.toBe(slotForSave("manual"));
  });
});
