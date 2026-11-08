import { describe, expect, it } from "vitest";
import {
  setLoadIntent,
  takeLoadIntent,
  type IntentStore,
} from "../src/engine/load-intent.js";

function fakeStore(): IntentStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("load intent across a reload", () => {
  it("round-trips the slot and clears it on read", () => {
    const s = fakeStore();
    setLoadIntent(3, s);
    expect(takeLoadIntent(s)).toBe(3);
    // Cleared: a second read (a later plain reload) finds nothing.
    expect(takeLoadIntent(s)).toBeUndefined();
  });

  it("returns undefined when no intent was recorded", () => {
    expect(takeLoadIntent(fakeStore())).toBeUndefined();
  });

  it("ignores a malformed stored value", () => {
    const s = fakeStore();
    s.setItem("ghostlight.loadSlot", "not-a-number");
    expect(takeLoadIntent(s)).toBeUndefined();
  });
});
