// The drunk's song about Von Braun is a voiced line (tester report, 20 Nov).
//
// The bug: with dialogue reading off, the screen reader still read the song.
// animation_16_2 draws its four lines of lyrics with centerText while the song
// plays as music, with no voice sample, so soundIsActive() was false and the
// layer emitted A11Y_TEXT. The player only hides A11Y_VTEXT lines.
//
// The fix (engine/a11y.cpp onText()): a line that is one of the song's lyrics
// (_texthis[1..4]) is voiced. There is no clip to wait for, so its A11Y_VEND
// follows at once, and the diff's `said` marks it voiced.
//
//   * Default (no engine build): assert the golden transcript
//     (fixtures/sung-lines.json), recorded from a native run with the fix.
//   * GHOSTLIGHT_NATIVE=1: load the walkthrough's chapter 2 save in slot 12
//     (inn bar, room 14), talk to the drunk (53), choose 1, then choose 2.

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

/** The song's first and last lines of lyrics (English). */
const FIRST = "A long time ago, it seems that Drascula killed Von Braun's wife";
const LAST = "Von Braun felt humiliated by his defeat";

function nativePaths() {
  return {
    binary: resolve(REPO_ROOT, "vendor", "scummvm", "scummvm"),
    gamePath: resolve(REPO_ROOT, "vendor", "game", "drascula"),
    extraPath: resolve(REPO_ROOT, "vendor", "scummvm", "dists", "engine-data"),
    savePath: process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine",
  };
}

/** Checks shared by the native run and the golden transcript. */
function expectSungLinesVoiced(lines: A11yLine[]): void {
  const texts = lines.filter(
    (l): l is Extract<A11yLine, { kind: "text" }> => l.kind === "text",
  );
  const lyrics = texts.filter((l) => l.text.startsWith(FIRST) || l.text.startsWith(LAST));
  expect(lyrics.length, "the song's first and last lines were drawn").toBe(2);
  for (const l of lyrics) expect(l.voiced, l.text).toBe(true);

  // Each lyric line is followed at once by its voice end.
  const lastIdx = lines.indexOf(lyrics[lyrics.length - 1]!);
  expect(lines[lastIdx + 1]?.kind).toBe("voiceEnd");

  // The diff's said marks the lyrics voiced too.
  const diff = lines.find(
    (l): l is Extract<A11yLine, { kind: "diff" }> => l.kind === "diff" && l.cmd === "choose 2",
  );
  expect(diff, "choose 2 settled with a diff").toBeDefined();
  const said = (diff?.said ?? []).filter((s) => s.text.startsWith(LAST));
  expect(said.length).toBe(1);
  // `voiced` is on the wire (layer contract) though SaidLine doesn't type it.
  expect((said[0] as { voiced?: boolean } | undefined)?.voiced).toBe(true);
}

describe("the drunk's song about Von Braun is a voiced line", () => {
  if (useNative()) {
    it("talk 53, choose 2 draws the lyrics as A11Y_VTEXT with A11Y_VEND", async () => {
      const harness = new NativeHarness({
        ...nativePaths(),
        saveSlot: 12,
        label: "native:sung-lines",
        settleMs: 120_000,
      });
      try {
        const start = await harness.start();
        expect(start.room).toBe(14);
        await harness.send("talk 53");
        await harness.send("choose 1");
        expectSungLinesVoiced(await harness.send("choose 2"));
      } finally {
        await harness.stop();
      }
    }, 600_000);
  } else {
    it("the golden transcript marks the lyrics voiced", () => {
      const path = resolve(HERE, "fixtures", "sung-lines.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
      expectSungLinesVoiced(parseStream(raw.lines.join("\n")));
    });
  }
});
