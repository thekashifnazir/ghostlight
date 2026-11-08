import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../src/engine/adapter.js";
import { ReplayAdapter } from "../src/engine/replay-adapter.js";
import { foldDiff, type EngineHintState } from "../src/hints/fold.js";
import {
  deserializeSnapshot,
  serializeSnapshot,
  snapshotsEqual,
  type SaveSnapshot,
} from "../src/engine/save-snapshot.js";

function fixture(name: string): string {
  const url = new URL(`../src/fixtures/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

/**
 * Drive the replay adapter through a command sequence and return the running
 * state the page would hold — the same room/chapter/flags/inventory the page
 * folds from A11Y lines (applyRoom + foldDiff). This is the state a save must
 * round-trip. No live engine (R6.4).
 */
function driveToState(
  logName: string,
  commands: Parameters<ReplayAdapter["send"]>[0][],
): EngineHintState {
  const adapter = new ReplayAdapter(fixture(logName));
  let state: EngineHintState = {
    chapter: 1,
    room: 0,
    flags: new Array(50).fill(0),
    inventory: [],
  };
  adapter.onEvent((e: EngineEvent) => {
    if (e.type === "room") {
      state = {
        chapter: e.state.chapter,
        room: e.state.room,
        flags: e.state.flags.slice(),
        inventory: e.state.inventory.slice(),
      };
    } else if (e.type === "diff") {
      state = foldDiff(state, e.diff);
    }
  });
  void adapter.start();
  for (const cmd of commands) adapter.send(cmd);
  return state;
}

describe("save round-trip property (R6.1)", () => {
  it("restores an arbitrary generated state exactly", () => {
    const arbState: fc.Arbitrary<SaveSnapshot> = fc.record({
      chapter: fc.integer({ min: 1, max: 6 }),
      room: fc.integer({ min: 0, max: 200 }),
      flags: fc.array(fc.integer({ min: 0, max: 1 }), {
        minLength: 50,
        maxLength: 50,
      }),
      inventory: fc.uniqueArray(fc.integer({ min: 7, max: 60 }), {
        maxLength: 20,
      }),
    });

    fc.assert(
      fc.property(arbState, (saved) => {
        // save = serialize; load = deserialize. The restored state must equal
        // what was saved: room, chapter, flags and inventory all come back.
        const loaded = deserializeSnapshot(serializeSnapshot(saved));
        expect(snapshotsEqual(saved, loaded)).toBe(true);
        expect(loaded.room).toBe(saved.room);
        expect(loaded.chapter).toBe(saved.chapter);
        expect(loaded.flags).toEqual(saved.flags);
        expect([...loaded.inventory].sort()).toEqual(
          [...saved.inventory].sort(),
        );
      }),
    );
  });

  it("round-trips real engine-derived states from replay fixtures", () => {
    // Each case drives the replay adapter to a genuine reachable state, then
    // asserts a save (serialize) + load (deserialize) returns the same state.
    const cases: { log: string; commands: Parameters<ReplayAdapter["send"]>[0][] }[] = [
      { log: "tavern.a11y.log", commands: [] },
      {
        log: "tavern.a11y.log",
        commands: [{ verb: "talk", target: 52 }], // gains the room key, sets flag 0
      },
      {
        log: "ch2-vending.a11y.log",
        commands: [
          { verb: "look", target: 188 },
          { verb: "use", item: 18, target: 188 }, // spends coins, gains cigarettes
        ],
      },
      {
        log: "leave-tavern.a11y.log",
        commands: [{ verb: "walk", target: 105 }], // crosses to chapter 2, room 14
      },
    ];

    for (const { log, commands } of cases) {
      const saved = driveToState(log, commands);
      const loaded = deserializeSnapshot(serializeSnapshot(saved));
      expect(snapshotsEqual(saved, loaded)).toBe(true);
    }
  });

  it("confirms the fixtures reach distinct, non-trivial states (the round-trip is meaningful)", () => {
    // A state in chapter 1 (tavern) with a non-empty inventory.
    const tavern = driveToState("tavern.a11y.log", [{ verb: "talk", target: 52 }]);
    expect(tavern.chapter).toBe(1);
    expect(tavern.inventory.length).toBeGreaterThan(0);

    // A state that crossed into chapter 2 — clearly distinct from the tavern.
    const crossed = driveToState("leave-tavern.a11y.log", [
      { verb: "walk", target: 105 },
    ]);
    expect(crossed.chapter).toBe(2);
    expect(crossed.room).toBe(14);

    // The two states are not equal, so a round-trip that returns the saved
    // state is doing real work, not trivially passing on identical inputs.
    expect(snapshotsEqual(tavern, crossed)).toBe(false);
  });
});
