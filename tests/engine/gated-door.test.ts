// A flag-gated door opens to a `walk` once its gating flag is set in the room.
//
// The bug (spec "gated-doors"): chapter-2 door 136 in room 5 is a passage only
// once flag 8 is set (rooms.cpp doors[] table, { 2, 136, 8 }). The engine keeps
// isDoor[slot] current for such a door only inside exitRoom(), via updateDoor().
// The a11y layer's walkObject() picked the door path from isDoor[slot] WITHOUT
// that refresh, so when the player set flag 8 while already standing in room 5
// (use the spike on the window), isDoor[136] stayed 0 and `walk 136` never
// opened the door — it settled changed:false instead of crossing to room 6.
//
// The fix calls e->updateDoor(slot) before the isDoor check in walkObject (and
// before reporting doors in the room snapshot/diff), exactly as exitRoom() does.
//
// The scenario needs the flag set WHILE in the room: a save taken AFTER flag 8
// is set would load with isDoor[136] already refreshed by enterRoom, so even
// the buggy build could walk it and the bug would not reproduce. So the save
// (scripts/make-gated-door-save.sh, slot 8) stands the hero in room 5 holding
// the spike with flag 8 still 0; the test sets the flag in-room via use, then
// walks.
//
//   * Default (no engine build): assert the golden transcript recorded from a
//     real native run of the fixed engine — `use 10 136` sets flag 8 and reports
//     door 136 opening, then `walk 136` crosses room 5 -> 6. This is the
//     deterministic evidence available with no engine build.
//   * GHOSTLIGHT_NATIVE=1: LOAD the room-5 save (slot 8), use the spike to set
//     flag 8 in-room, then `walk 136`. Before the fix the walk settles
//     changed:false (no room change); after it, the walk's diff carries
//     room:[5,6]. The save must have been produced first by
//     scripts/make-gated-door-save.sh.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseStream } from "./src/parse.js";
import { NativeHarness } from "./src/native.js";
import { useNative } from "./src/fixture.js";
import type { A11yLine, Diff } from "./src/lines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** The save slot scripts/make-gated-door-save.sh writes the room-5 state to. */
const GATED_DOOR_SLOT = 8;

/** The one diff a command settled with. */
function diffOf(lines: A11yLine[], cmd: string): Diff | undefined {
  return lines.find((l): l is Diff => l.kind === "diff" && l.cmd === cmd);
}

/** Resolve the native engine paths from the repo layout (vendor/ + build). */
function nativePaths() {
  return {
    binary: resolve(REPO_ROOT, "vendor", "scummvm", "scummvm"),
    gamePath: resolve(REPO_ROOT, "vendor", "game", "drascula"),
    extraPath: resolve(REPO_ROOT, "vendor", "scummvm", "dists", "engine-data"),
    savePath: process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine",
  };
}

/**
 * Assert the use+walk sequence opened the gated door: the use set flag 8 and
 * the walk crossed room 5 -> 6. Shared by the native and golden-transcript
 * paths so both prove the same behaviour.
 */
function expectGatedDoorOpened(use: Diff | undefined, walk: Diff | undefined): void {
  // use 10 136 sets flag 8 (the window action, animation_5_2) and consumes the
  // spike. This part works with or without the fix; it establishes the scenario.
  expect(use, "use 10 136 produced a diff").toBeDefined();
  expect(use!.flags, "use 10 136 set flag 8").toMatchObject({ "8": [0, 1] });
  expect(use!.invRemoved, "the spike was consumed").toEqual([
    { id: 10, name: "spike" },
  ]);

  // walk 136 must now CROSS to room 6 (the fix). Before the fix this diff was
  // changed:false with no room field.
  expect(walk, "walk 136 produced a diff").toBeDefined();
  expect(walk!.room, "walk 136 crossed room 5 -> 6").toEqual([5, 6]);
  expect(walk!.changed).toBe(true);
  // The crossing carries room 6's objects, including the door back to room 5.
  const backDoor = (walk!.objects ?? []).find((o) => o.num === 137);
  expect(backDoor?.toRoom, "room 6 carries the door back to room 5").toBe(5);
}

describe("a flag-gated door opens to `walk` once the flag is set in the room", () => {
  if (useNative()) {
    it("use spike on window 136 then walk 136 crosses room 5 -> 6 (slot 8)", async () => {
      // LOAD the room-5 save: hero in room 5, spike held, flag 8 still 0.
      // Produced by scripts/make-gated-door-save.sh before this run.
      const harness = new NativeHarness({
        ...nativePaths(),
        saveSlot: GATED_DOOR_SLOT,
        label: `native:gated-door:slot${GATED_DOOR_SLOT}`,
        settleMs: 60_000,
      });
      try {
        const start = await harness.start();
        expect(start.chapter, "loaded chapter 2").toBe(2);
        expect(start.room, "loaded room 5").toBe(5);
        expect(start.flags[8], "flag 8 starts unset").toBe(0);

        // Set flag 8 in-room by using the spike on the window.
        const useLines = await harness.send("use 10 136");
        // Then walk the now-opened gated door. Before the fix this never crossed.
        const walkLines = await harness.send("walk 136");

        expectGatedDoorOpened(
          diffOf(useLines, "use 10 136"),
          diffOf(walkLines, "walk 136"),
        );
      } finally {
        await harness.stop();
      }
    });
  } else {
    it("the golden transcript records the gated door opening and the crossing", () => {
      // Recorded from a real native run of the FIXED engine (loading slot 8,
      // use 10 136, walk 136). If the walk had not crossed (the bug), the walk
      // diff would be changed:false with no room field and this would fail.
      const path = resolve(HERE, "fixtures", "gated-door-ch2.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        label: string;
        steps: { cmd: string; raw: string[] }[];
      };
      const byCmd = (cmd: string): Diff | undefined => {
        const step = raw.steps.find((s) => s.cmd === cmd);
        if (!step) return undefined;
        return diffOf(parseStream(step.raw.join("\n")), cmd);
      };
      expectGatedDoorOpened(byCmd("use 10 136"), byCmd("walk 136"));
    });
  }
});
