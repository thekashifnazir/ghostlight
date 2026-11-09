import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { RoomObject, RoomState } from "../src/engine/adapter.js";
import { buildHotspotList, type Hotspot } from "../src/model/hotspot-list.js";
import { uniquifyNames } from "../src/model/naming.js";
import { loadPack, type PackData } from "../src/model/pack.js";

// A pack with no rooms/items: every lookup misses, so the hotspot list falls
// back to engine names. This isolates the ordering and de-duplication logic,
// which is what the property pins (R14.3, 1.3, 2.5).
const emptyPack = loadPack({
  formatVersion: "1.0",
  rooms: {},
  items: [],
} as unknown as PackData);

/** A generated room object with small, often-overlapping rects to force ties. */
const arbObject = (num: number): fc.Arbitrary<RoomObject> =>
  fc.record({
    num: fc.constant(num),
    name: fc.constantFrom("DOOR", "BARMAN", "CUBO", "SKULL", "PUERTA"),
    rect: fc.tuple(
      fc.integer({ min: 0, max: 8 }), // x, small range so left edges tie often
      fc.integer({ min: 0, max: 8 }), // y
      fc.integer({ min: 1, max: 40 }), // w
      fc.integer({ min: 1, max: 40 }), // h
    ) as fc.Arbitrary<[number, number, number, number]>,
    walkTo: fc.tuple(
      fc.integer({ min: 0, max: 320 }),
      fc.integer({ min: 0, max: 200 }),
    ) as fc.Arbitrary<[number, number]>,
    visible: fc.boolean(),
    door: fc.boolean(),
  });

/** A room state with distinct hotspot numbers (the engine guarantees this). */
const arbRoomState: fc.Arbitrary<RoomState> = fc
  .uniqueArray(fc.integer({ min: 1, max: 250 }), { minLength: 0, maxLength: 12 })
  .chain((nums) =>
    fc.record({
      chapter: fc.constantFrom(1, 2),
      room: fc.constantFrom(62, 14, 16, 15),
      hero: fc.record({
        x: fc.integer({ min: 0, max: 320 }),
        y: fc.integer({ min: 0, max: 200 }),
      }),
      objects: fc.tuple(...nums.map((n) => arbObject(n))),
      inventory: fc.constant<number[]>([]),
      flags: fc.constant<number[]>(new Array(50).fill(0)),
    }),
  );

describe("buildHotspotList properties", () => {
  it("contains exactly the visible hotspots, each once", () => {
    fc.assert(
      fc.property(arbRoomState, (state) => {
        const list = buildHotspotList(state, emptyPack);
        const expected = state.objects
          .filter((o) => o.visible)
          .map((o) => o.num)
          .sort((a, b) => a - b);
        const got = list.map((h) => h.num).sort((a, b) => a - b);
        expect(got).toEqual(expected);
        // Each once: no duplicates.
        expect(new Set(got).size).toBe(got.length);
      }),
    );
  });

  it("is ordered non-decreasing by (rect.left, rect.top)", () => {
    fc.assert(
      fc.property(arbRoomState, (state) => {
        const list = buildHotspotList(state, emptyPack);
        for (let i = 1; i < list.length; i++) {
          const prev = list[i - 1].rect;
          const cur = list[i].rect;
          const ok = prev[0] < cur[0] || (prev[0] === cur[0] && prev[1] <= cur[1]);
          expect(ok).toBe(true);
        }
      }),
    );
  });
});

describe("buildHotspotList with a duplicate engine hotspot number", () => {
  // Drascula's chapter-2 street (room 12) reports the BALCONY object twice,
  // both numbered 154, for its two balcony rects. To the engine these are the
  // same object (an action keys on the number). Building the list must keep one
  // entry and never throw — the old throw escaped the printErr reader, stranded
  // the room change and wedged the player "busy" forever.
  const balcony = (rect: [number, number, number, number]): RoomObject => ({
    num: 154,
    name: "BALCONY",
    rect,
    walkTo: [rect[0], rect[1] + rect[3]],
    visible: true,
    door: false,
  });

  const room12: RoomState = {
    chapter: 2,
    room: 12,
    hero: { x: 160, y: 150 },
    objects: [balcony([92, 83, 29, 37]), balcony([177, 83, 27, 35])],
    inventory: [],
    flags: new Array(50).fill(0),
  };

  it("keeps one entry for the duplicated number and does not throw", () => {
    const list = buildHotspotList(room12, emptyPack);
    const balconies = list.filter((h) => h.num === 154);
    expect(balconies.length).toBe(1);
    // The first entry seen wins (the earlier-left-edge rect here).
    expect(balconies[0].rect).toEqual([92, 83, 29, 37]);
  });

  it("warns once per room about the reuse", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      buildHotspotList(room12, emptyPack);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("154");
      expect(warn.mock.calls[0][0]).toContain("room 12");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("uniquifyNames properties", () => {
  // Hotspots sharing names, with distinct left edges so ordering is defined.
  const arbHotspots: fc.Arbitrary<Hotspot[]> = fc
    .array(
      fc.record({
        num: fc.integer({ min: 1, max: 999 }),
        kind: fc.constantFrom("object", "npc", "exit") as fc.Arbitrary<
          Hotspot["kind"]
        >,
        name: fc.constantFrom("door", "window", "lamp", "bin"),
        rect: fc.tuple(
          fc.integer({ min: 0, max: 300 }),
          fc.integer({ min: 0, max: 200 }),
          fc.integer({ min: 1, max: 40 }),
          fc.integer({ min: 1, max: 40 }),
        ) as fc.Arbitrary<[number, number, number, number]>,
        walkTo: fc.constant<[number, number]>([0, 0]),
      }),
      { minLength: 0, maxLength: 10 },
    )
    // Give distinct nums so identity is stable.
    .map((hs) => hs.map((h, i) => ({ ...h, num: i + 1 })));

  it("yields distinct names within every duplicate group", () => {
    fc.assert(
      fc.property(arbHotspots, (hotspots) => {
        const out = uniquifyNames(hotspots);
        // Group the ORIGINAL by base name; within each group of size >= 2 the
        // output names must all be distinct.
        const groups = new Map<string, number[]>();
        hotspots.forEach((h, i) => {
          const g = groups.get(h.name) ?? [];
          g.push(i);
          groups.set(h.name, g);
        });
        for (const indices of groups.values()) {
          if (indices.length < 2) continue;
          const names = indices.map((i) => out[i].name);
          expect(new Set(names).size).toBe(names.length);
        }
      }),
    );
  });

  it("leaves a one-of-a-kind name unchanged", () => {
    const out = uniquifyNames([
      { num: 1, kind: "object", name: "skull", rect: [10, 10, 5, 5], walkTo: [0, 0] },
    ]);
    expect(out[0].name).toBe("skull");
  });
});
