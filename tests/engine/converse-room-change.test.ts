// A room change after a conversation is reported (tester report, 18 Nov).
//
// The bug: when a conversation ends and the game then moves the hero (in
// chapter 2, passing the test in room 18 puts you back in room 17), no line
// named the new room. A `talk` emits its diffs from the converse hook, before
// the move. poll()'s room-change branch assumed the command's diff carried the
// new room, so it only synced its markers. The web player kept room 18's list,
// and the next press failed with "object 55 is not in this room".
//
// The fix (engine/a11y.cpp poll()): track whether poll itself emitted the
// command's diff (diffCarriedRoom). When the room changed and it didn't, emit
// the new room's state, as for a room change no command drove.
//
//   * Default (no engine build): assert the golden transcript
//     (fixtures/converse-room-change.json), recorded from a native run with the
//     fix: after the `choose 2` diff, an A11Y room state for room 17.
//   * GHOSTLIGHT_NATIVE=1: load a chapter 2 save in slot 12 at the inn bar
//     (room 14) with the earplugs, as the walkthrough's slot 12 is; walk to
//     room 18, wear the earplugs, talk to 55 and take the test. Room 17's state
//     must arrive before the next command's echo.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseStream } from "./src/parse.js";
import { NativeHarness } from "./src/native.js";
import { useNative } from "./src/fixture.js";
import type { A11yLine } from "./src/lines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** The index of the first line matching `pred`, or -1. */
function indexOf(lines: A11yLine[], pred: (l: A11yLine) => boolean): number {
  return lines.findIndex(pred);
}

function nativePaths() {
  return {
    binary: resolve(REPO_ROOT, "vendor", "scummvm", "scummvm"),
    gamePath: resolve(REPO_ROOT, "vendor", "game", "drascula"),
    extraPath: resolve(REPO_ROOT, "vendor", "scummvm", "dists", "engine-data"),
    savePath: process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine",
  };
}

describe("a room change after a conversation is reported", () => {
  if (useNative()) {
    it("passing the room 18 test emits room 17's state with no further command", async () => {
      const harness = new NativeHarness({
        ...nativePaths(),
        saveSlot: 12,
        label: "native:converse-room-change",
        settleMs: 120_000,
      });
      try {
        const start = await harness.start();
        expect(start.room).toBe(14);
        for (const cmd of ["walk 159", "walk 151", "walk 146", "walk 126", "walk 175", "walk 177", "use 11 50", "talk 55"]) {
          await harness.send(cmd);
        }
        // `choose 2` settles on its own diff; room 17's state follows it. The
        // next command's lines start where `choose 2` settled, so room 17's state
        // must come BEFORE that command's echo (a `dump` prints room 17 too).
        await harness.send("choose 2");
        const lines = await harness.send("dump");
        const roomIdx = indexOf(lines, (l) => l.kind === "room");
        const dumpIdx = indexOf(lines, (l) => l.kind === "cmd" && l.text === "dump");
        expect(roomIdx, "a room state arrived").toBeGreaterThanOrEqual(0);
        expect(roomIdx, "room 17's state arrived before the next command").toBeLessThan(dumpIdx);
        expect((lines[roomIdx] as Extract<A11yLine, { kind: "room" }>).room).toBe(17);
      } finally {
        await harness.stop();
      }
    }, 600_000);
  } else {
    it("the golden transcript names room 17 straight after the choose 2 diff", () => {
      const path = resolve(HERE, "fixtures", "converse-room-change.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
      const lines = parseStream(raw.lines.join("\n"));

      // The transcript starts by walking into room 18.
      const walkIdx = indexOf(lines, (l) => l.kind === "diff" && l.cmd === "walk 177");
      expect(walkIdx).toBeGreaterThanOrEqual(0);

      // The conversation's last diff, then room 17's state with no command between.
      const chooseIdx = indexOf(lines, (l) => l.kind === "diff" && l.cmd === "choose 2");
      expect(chooseIdx, "choose 2 settled with a diff").toBeGreaterThan(walkIdx);
      const roomIdx = indexOf(lines, (l) => l.kind === "room");
      expect(roomIdx, "a room state follows the choose 2 diff").toBeGreaterThan(chooseIdx);
      const room = lines[roomIdx] as Extract<A11yLine, { kind: "room" }>;
      expect(room.room).toBe(17);
      expect(
        lines.slice(chooseIdx + 1, roomIdx).some((l) => l.kind === "cmd"),
        "no command was needed to get room 17's state",
      ).toBe(false);
    });
  }
});
