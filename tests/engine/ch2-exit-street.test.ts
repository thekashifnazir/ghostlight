// The chapter-2 inn-bar -> street exit settles (does not wedge the player).
//
// The bug (the chapter-2 blocker): using the inn-bar exit "stairs down to the
// street" (room 14, hotspot/object 159 -> room 12) via `walk 159` left the web
// player wedged on `busy` for 60s+, the hotspot list still showed the inn bar,
// and the exit said nothing. The engine DID change to room 12 — the defect was
// in the a11y layer's command COMPLETION:
//
//   * poll() stamps its liveness clock (_lastPollMs) at the TOP of the frame,
//     BEFORE runCommand(). The whole walk + door transition runs inside that
//     one frame (hundreds of ms), so by the TAIL the stamp is stale
//     (> kPollFreshMs) and the control probe reads the player as NOT in
//     control, so updateControlPhase() emits `busy` — never `A11Y_PHASE
//     control`. The web player (src/engine/status.ts) drives its phase ONLY
//     from A11Y_PHASE under engine truth and never settles on the diff, so it
//     stays `busy` forever.
//   * A command-driven room change also deliberately SUPPRESSED the A11Y
//     room-state line (it relied on the diff alone), so the player's hotspot
//     list never refreshed to room 12 and the new room name was never spoken.
//
// The fix (engine/a11y.cpp poll() tail): on a command-driven within-chapter
// room change, re-emit the new room's A11Y state line (refreshing the hotspot
// list and surfacing the room name on arrival) AND re-stamp _lastPollMs so the
// control probe reads the player back in control on the settling frame, so
// `A11Y_PHASE control` is emitted. The chapter-crossing path (door 105) returns
// true earlier and keeps its single-diff carrier shape, so it is untouched.
//
//   * Default (no engine build): assert the golden transcript recorded from a
//     real native run of the FIXED engine — `walk 159` changes room 14 -> 12,
//     the room-12 A11Y state line is re-emitted with the street's own hotspots,
//     and the raw stream ends on `A11Y_PHASE control`. This is the deterministic
//     evidence available with no engine build.
//   * GHOSTLIGHT_NATIVE=1: drive the real native binary from the chapter-2 save
//     via scripts/ch2-exit-street.sh, which LOADS slot 9, issues `walk 159` from
//     room 14, and asserts the same three facts (room change, re-emitted room-12
//     state, trailing `A11Y_PHASE control`) against the live engine. The script
//     SKIPS cleanly (exit 3) when the native build or game data is absent, or if
//     the chapter-2 save cannot be produced unattended (the native SDL binary
//     needs a real window, gotcha 12), so an unattended run never hangs.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseStream } from "./src/parse.js";
import { useNative } from "./src/fixture.js";
import type { A11yLine, Diff, RoomState } from "./src/lines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** The chapter-2 save slot scripts/make-ch2-save.sh writes room 14 into. */
const CH2_SLOT = 9;

/** The one diff a command settled with. */
function diffOf(lines: A11yLine[], cmd: string): Diff | undefined {
  return lines.find((l): l is Diff => l.kind === "diff" && l.cmd === cmd);
}

/** Every room-state line in a parsed stream, in order. */
function roomStatesOf(lines: A11yLine[]): RoomState[] {
  return lines.filter((l): l is RoomState => l.kind === "room");
}

/**
 * Assert the parsed `walk 159` transcript shows the exit settling: the room
 * changed 14 -> 12, and the new room's A11Y state line was re-emitted with the
 * street's own hotspots (so the player's hotspot list refreshes and the room
 * name is spoken). Shared by the native and golden-transcript paths.
 */
function expectExitSettled(start: RoomState, stepLines: A11yLine[]): void {
  // The run starts in chapter 2 room 14 (the inn bar).
  expect(start.chapter, "starts in chapter 2").toBe(2);
  expect(start.room, "starts in room 14 (inn bar)").toBe(14);

  // walk 159 changes room 14 -> 12 (the engine room change was never the bug).
  const walk = diffOf(stepLines, "walk 159");
  expect(walk, "walk 159 produced a diff (the engine did not wedge)").toBeDefined();
  expect(walk!.room, "walk 159 crossed room 14 -> 12").toEqual([14, 12]);
  expect(walk!.changed).toBe(true);

  // The fix: the new room's A11Y state line is RE-EMITTED after the diff, so the
  // hotspot list refreshes to room 12 and the room name is spoken on arrival.
  const room12 = roomStatesOf(stepLines).find((r) => r.room === 12);
  expect(
    room12,
    "the room-12 A11Y state line must be re-emitted after the exit (hotspot list + room name)",
  ).toBeDefined();
  expect(room12!.chapter).toBe(2);
  // It carries the street's OWN hotspots, not the inn bar's — e.g. the inn door
  // (156 -> room 14) and the street-to-square exit (151 -> room 10).
  const innDoor = room12!.objects.find((o) => o.num === 156);
  expect(innDoor?.toRoom, "room 12 carries the inn door back to room 14").toBe(14);
  const toSquare = room12!.objects.find((o) => o.num === 151);
  expect(toSquare?.toRoom, "room 12 carries the exit to the village square").toBe(10);
}

describe("chapter-2 inn-bar -> street exit settles (no permanent busy)", () => {
  if (useNative()) {
    it("walk 159 from room 14 settles to room 12 with A11Y_PHASE control (native)", () => {
      // Drive the real native binary from the chapter-2 save. The script does
      // the full guard set (room change, re-emitted room-12 state, trailing
      // A11Y_PHASE control) and SKIPS (exit 3) if the build/data/save is absent.
      const script = resolve(REPO_ROOT, "scripts", "ch2-exit-street.sh");
      const run = spawnSync(
        "bash",
        [script, "/tmp/ghostlight-engine", String(CH2_SLOT)],
        { encoding: "utf8", timeout: 300_000 },
      );

      if (run.status === 3) {
        // Clean skip: no native build / data / reachable save (gotcha 12).
        const why = (run.stderr ?? "").trim().split("\n").pop() ?? "native build absent";
        console.warn(`[ch2-exit-street] skipped: ${why}`);
        return;
      }

      expect(
        run.status,
        `scripts/ch2-exit-street.sh failed (exit ${run.status}).\n${run.stderr}`,
      ).toBe(0);

      // Parse the captured A11Y lines the script printed to stdout and assert
      // the settled transcript, the same way the golden path does.
      const lines = parseStream(run.stdout ?? "");
      const start = roomStatesOf(lines)[0];
      expect(start, "captured a starting room state").toBeDefined();
      expectExitSettled(start!, lines);

      // The live run must end on `A11Y_PHASE control` (the parser drops phase
      // lines, so assert on the raw stdout): the command settled and the web
      // player returns to ready. Without the fix the last phase stays `busy`.
      const phases = (run.stdout ?? "")
        .split(/\r?\n/)
        .filter((l) => l.startsWith("A11Y_PHASE "));
      expect(phases.length, "at least one A11Y_PHASE line").toBeGreaterThan(0);
      expect(phases[phases.length - 1], "last phase after the exit is control").toBe(
        "A11Y_PHASE control",
      );
    });
  } else {
    it("the golden transcript records the exit settling and A11Y_PHASE control", () => {
      // Recorded from a real native run of the FIXED engine (loading slot 9,
      // walk 159 from room 14). If the exit had wedged (the bug), there would be
      // no room-12 state line after the diff and the stream would not end on
      // `A11Y_PHASE control`, so this would fail.
      const path = resolve(HERE, "fixtures", "ch2-exit-street.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        label: string;
        startRaw: string;
        steps: { cmd: string; raw: string[] }[];
      };

      const start = parseStream(raw.startRaw)[0] as RoomState;
      const step = raw.steps.find((s) => s.cmd === "walk 159");
      expect(step, "the fixture records the walk 159 step").toBeDefined();

      const stepLines = parseStream(step!.raw.join("\n"));
      expectExitSettled(start, stepLines);

      // The parser intentionally drops A11Y_PHASE lines, so assert the control
      // phase on the raw step text: the LAST A11Y_PHASE line of the step is
      // `control`, the edge that returns the web player to ready after the exit.
      const phases = step!.raw.filter((l) => l.startsWith("A11Y_PHASE "));
      expect(phases.length, "the step carries A11Y_PHASE lines").toBeGreaterThan(0);
      expect(
        phases[phases.length - 1],
        "the exit's last phase line is control (not a stuck busy)",
      ).toBe("A11Y_PHASE control");
    });
  }
});
