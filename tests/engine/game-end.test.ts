// The game's final ending: `use 9 56` (the crucifix on Drascula, chapter 6
// room 60) runs animation_9_6 — the ending scene, then minutes of credits —
// and run() quits after chapter 6. Before the fix the layer stashed a
// cross-chapter diff for a chapter 7 that never comes, so nothing at all was
// emitted after `A11Y_CMD use 9 56` until the engine exited.
//
// The fix: one `A11Y_GAME_END {"cmd":..,"said":[..]}` line, emitted from the
// onGameEnd() hook in animation_9_6 just before the credits (with the poll()
// chapter-end path as a fallback), never a stashed diff.
//
//   * Default: the line contract — the parser recognises A11Y_GAME_END and the
//     native harness counts it as a settle.
//   * GHOSTLIGHT_NATIVE=1 with GHOSTLIGHT_CH6_SLOT=<slot> (a chapter 6 save in
//     room 60): drive the real ending and assert the line arrives with no diff.
//     With GHOSTLIGHT_CH3_SLOT=<slot> (chapter 3 save, e.g. 31): the control,
//     `use 9 51` still crosses to chapter 4 room 21 in one diff.
import { describe, expect, it } from "vitest";
import { parseLine, parseStream } from "./src/parse.js";
import { NativeHarness } from "./src/native.js";
import { nativePaths, useNative } from "./src/fixture.js";
import type { A11yLine, Diff } from "./src/lines.js";

describe("A11Y_GAME_END line contract", () => {
  it("parses into a gameEnd line with the ending's said lines", () => {
    const line =
      'A11Y_GAME_END {"cmd":"use 9 56","said":[{"color":"white","text":"THE END."}]}';
    expect(parseLine(line)).toEqual({
      kind: "gameEnd",
      cmd: "use 9 56",
      said: [{ color: "white", text: "THE END." }],
    });
  });
  it("is not mistaken for a room-state line", () => {
    const lines = parseStream(
      'A11Y_CMD use 9 56\nA11Y_TEXT THE END.\nA11Y_GAME_END {"cmd":"use 9 56","said":[]}',
    );
    expect(lines.map((l) => l.kind)).toEqual(["cmd", "text", "gameEnd"]);
  });
  it("parses the bare A11Y_EXIT engine-stop line", () => {
    expect(parseLine("A11Y_EXIT")).toEqual({ kind: "exit" });
  });
});

const ch6Slot = process.env.GHOSTLIGHT_CH6_SLOT;
const ch3Slot = process.env.GHOSTLIGHT_CH3_SLOT;

function harness(slot: string, settleMs: number): NativeHarness {
  const p = nativePaths();
  return new NativeHarness({
    binary: p.binary,
    gamePath: p.gamePath,
    extraPath: p.extraPath,
    saveSlot: Number(slot),
    settleMs,
    label: `native:slot${slot}`,
  });
}

describe.skipIf(!useNative() || !ch6Slot)("native: the chapter 6 ending", () => {
  it(
    "use 9 56 emits one A11Y_GAME_END and no diff",
    async () => {
      const h = harness(ch6Slot as string, 300_000);
      const start = await h.start();
      expect(start.chapter).toBe(6);
      expect(start.room).toBe(60);
      for (const cmd of ["push 112", "talk 52", "choose 3", "use 21 56"]) {
        await h.send(cmd);
      }
      const lines: A11yLine[] = await h.send("use 9 56");
      const ends = lines.filter((l) => l.kind === "gameEnd");
      expect(ends).toHaveLength(1);
      expect(lines.some((l) => l.kind === "diff")).toBe(false);
      expect(lines.some((l) => l.kind === "err")).toBe(false);
      // Not a stashed chapter-7 diff: the line arrives before the credits.
      // After them the engine says A11Y_EXIT; that wait is not asserted here
      // (minutes of credits).
      await h.stop();
    },
    600_000,
  );
});

describe.skipIf(!useNative() || !ch3Slot)("native: chapters still cross (control)", () => {
  it(
    "chapter 3 use 9 51 reaches chapter 4 room 21 in one diff",
    async () => {
      const h = harness(ch3Slot as string, 120_000);
      const start = await h.start();
      expect(start.chapter).toBe(3);
      const lines = await h.send("use 9 51");
      const diffs = lines.filter((l): l is Diff => l.kind === "diff");
      expect(diffs).toHaveLength(1);
      expect(diffs[0]?.chapter).toEqual([3, 4]);
      expect(diffs[0]?.room?.[1]).toBe(21);
      expect(lines.some((l) => l.kind === "gameEnd")).toBe(false);
      await h.stop();
    },
    300_000,
  );
});
