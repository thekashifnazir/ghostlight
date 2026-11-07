import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RoomObject, RoomState } from "../src/engine/adapter.js";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { buildPings } from "../src/sonar/mapping.js";

// The property tests pin the pure mapping's invariants (Requirement 1): one
// ping per visible thing (none for invisible), left-to-right order by rect
// centre x, pan within -1..1 and non-decreasing in x, pan sign matching the
// hero side, higher things higher in pitch, nearer things brighter, and a text
// equivalent that names the thing, its kind, its direction and its band.
//
// buildPings takes a RoomState and the room's Hotspot[]. It selects by
// re-checking `visible` on state.objects and matches hotspots to objects by
// `num`, so the generator builds both from one set of objects: the hotspots
// mirror the objects' num/rect, with a kind and a name. Invisible objects get a
// hotspot too, to prove they are excluded by the mapping, not by the list.

const kindOf = (o: RoomObject): Hotspot["kind"] =>
  o.door ? "exit" : o.num % 3 === 0 ? "npc" : "object";

const hotspotFor = (o: RoomObject): Hotspot => ({
  num: o.num,
  kind: kindOf(o),
  name: `thing-${o.num}`,
  rect: o.rect,
  walkTo: o.walkTo,
});

const arbObject = (num: number): fc.Arbitrary<RoomObject> =>
  fc.record({
    num: fc.constant(num),
    name: fc.constant(`THING ${num}`),
    rect: fc.tuple(
      fc.integer({ min: 0, max: 300 }), // x
      fc.integer({ min: 0, max: 180 }), // y
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

/** A room with distinct hotspot numbers and a random hero inside the room. */
const arbRoom: fc.Arbitrary<{ state: RoomState; list: Hotspot[] }> = fc
  .uniqueArray(fc.integer({ min: 1, max: 250 }), { minLength: 0, maxLength: 12 })
  .chain((nums) =>
    fc
      .record({
        hero: fc.record({
          x: fc.integer({ min: 0, max: 320 }),
          y: fc.integer({ min: 0, max: 200 }),
        }),
        objects: fc.tuple(...nums.map((n) => arbObject(n))),
      })
      .map(({ hero, objects }) => {
        const state: RoomState = {
          chapter: 1,
          room: 62,
          hero,
          objects,
          inventory: [],
          flags: new Array(50).fill(0),
        };
        // Hotspots mirror every object (visible or not); buildPings must drop
        // the invisible ones itself.
        const list = objects.map(hotspotFor);
        return { state, list };
      }),
  );

const centreX = (r: readonly [number, number, number, number]) => r[0] + r[2] / 2;
const centreY = (r: readonly [number, number, number, number]) => r[1] + r[3] / 2;

describe("buildPings properties", () => {
  it("emits exactly one ping per visible thing and none for invisible", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        const pings = buildPings(state, list);
        const visibleNums = state.objects
          .filter((o) => o.visible)
          .map((o) => o.num)
          .sort((a, b) => a - b);
        const invisibleNums = new Set(
          state.objects.filter((o) => !o.visible).map((o) => o.num),
        );
        const got = pings.map((p) => p.num).sort((a, b) => a - b);
        expect(got).toEqual(visibleNums);
        // Each once.
        expect(new Set(got).size).toBe(got.length);
        // None invisible.
        for (const p of pings) expect(invisibleNums.has(p.num)).toBe(false);
      }),
    );
  });

  it("is ordered non-decreasing by rect centre x (ties by centre y)", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        const pings = buildPings(state, list);
        const byNum = new Map(state.objects.map((o) => [o.num, o]));
        for (let i = 1; i < pings.length; i++) {
          const prev = byNum.get(pings[i - 1].num)!.rect;
          const cur = byNum.get(pings[i].num)!.rect;
          const ordered =
            centreX(prev) < centreX(cur) ||
            (centreX(prev) === centreX(cur) && centreY(prev) <= centreY(cur));
          expect(ordered).toBe(true);
        }
      }),
    );
  });

  it("keeps every pan within -1..1", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        for (const p of buildPings(state, list)) {
          expect(p.pan).toBeGreaterThanOrEqual(-1);
          expect(p.pan).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("makes pan non-decreasing as centre x increases", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        const pings = buildPings(state, list);
        for (let i = 1; i < pings.length; i++) {
          // Pings are already in centre-x order, so pan must be non-decreasing.
          expect(pings[i].pan).toBeGreaterThanOrEqual(pings[i - 1].pan);
        }
      }),
    );
  });

  it("gives pan a sign matching the side of the hero", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        for (const p of buildPings(state, list)) {
          if (p.centreX < state.hero.x) expect(p.pan).toBeLessThanOrEqual(0);
          if (p.centreX > state.hero.x) expect(p.pan).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("gives higher things (smaller centre y) higher pitch", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        const pings = buildPings(state, list);
        const byNum = new Map(state.objects.map((o) => [o.num, o]));
        for (const a of pings) {
          for (const b of pings) {
            const ya = centreY(byNum.get(a.num)!.rect);
            const yb = centreY(byNum.get(b.num)!.rect);
            if (ya < yb) expect(a.freq).toBeGreaterThan(b.freq);
          }
        }
      }),
    );
  });

  it("gives nearer things a higher (brighter) cutoff", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        const pings = buildPings(state, list);
        for (const a of pings) {
          for (const b of pings) {
            if (a.distance < b.distance) expect(a.cutoff).toBeGreaterThan(b.cutoff);
          }
        }
      }),
    );
  });

  it("puts the name, kind, direction and band words in the text", () => {
    fc.assert(
      fc.property(arbRoom, ({ state, list }) => {
        for (const p of buildPings(state, list)) {
          expect(p.text).toContain(p.name);
          expect(p.text).toContain(p.kind);
          expect(p.text).toContain(p.direction);
          expect(p.text).toContain(p.band);
        }
      }),
    );
  });
});
