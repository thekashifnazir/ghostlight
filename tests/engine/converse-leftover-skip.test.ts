// A leftover `skip` queued while a conversation is open must not wedge the
// converse command queue: the next `choose` has to be applied.
//
// Root cause of the chapter-2 dead state (proven from raw Module.printErr
// output of a replay): in engine/a11y.cpp A11yLayer::onConverseFrame, the queue
// loop handled only `choices` and `choose`. Any other verb at the head of the
// queue hit a bare `break;` WITHOUT consuming it, so a leftover `skip` — queued
// by an Enter pressed during an option's story reply, and not drained by that
// reply's own speech loop because the player over-skipped — sat at the head
// forever. `_queueHead` never advanced, so the player's following `choose 3`
// was never read: it was never echoed as `A11Y_CMD`, never applied, and no
// later command settled, while onUpdateEvents() kept running and the busy
// watchdog fired.
//
// The fix (onConverseFrame): in that loop, a `skip` at the head is consumed
// silently (echoed `A11Y_CMD skip`, no error, `_queueHead++`, continue) — it
// has nothing left to skip inside an open choice menu, so it is a harmless
// no-op — and any OTHER verb while a conversation is open is rejected with
// `A11Y_ERR finish the conversation first: <cmd>` and likewise consumed. The
// loop never `break`s with an unconsumed head.
//
//   * Default (no engine build): assert the golden transcript
//     (fixtures/converse-leftover-skip.json), which records the fixed sequence:
//     `choose 2`, a drained reply skip, a SURPLUS `skip` echoed with no error
//     or state change, then `choose 3` echoed and settled with its own diff.
//     This is the deterministic evidence available with no engine.
//   * GHOSTLIGHT_NATIVE=1: load the chapter-2 save (slot 9), open the Von Braun
//     conversation, pick option 2, then queue TWO skips (one drained by the
//     reply, one surplus) and a `choose 3`. The `choose 3` must settle with its
//     own diff under a short cap, proving the head was not wedged.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseStream } from "./src/parse.js";
import { NativeHarness } from "./src/native.js";
import { useNative } from "./src/fixture.js";
import type { A11yLine, CmdEcho, Diff, ErrLine } from "./src/lines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

function cmds(lines: A11yLine[]): CmdEcho[] {
  return lines.filter((l): l is CmdEcho => l.kind === "cmd");
}
function diffs(lines: A11yLine[]): Diff[] {
  return lines.filter((l): l is Diff => l.kind === "diff");
}
function errs(lines: A11yLine[]): ErrLine[] {
  return lines.filter((l): l is ErrLine => l.kind === "err");
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

describe("a leftover skip in an open conversation does not wedge the queue", () => {
  if (useNative()) {
    it("a surplus skip is drained and the following `choose 3` still settles", async () => {
      // Load the chapter-2 start (slot 9), as the chapter-2 fixtures do, so the
      // Von Braun / NPC conversation is reachable without replaying chapter 1.
      const harness = new NativeHarness({
        ...nativePaths(),
        saveSlot: 9,
        label: "native:converse-leftover-skip",
        settleMs: 20_000,
      });
      try {
        const start = await harness.start();
        expect(start.chapter).toBe(2);

        // Open the conversation and pick option 2; its reply runs a short story.
        await harness.send("talk 52");
        await harness.send("choose 2");

        // One skip is drained by the reply's own speech loop; the second is a
        // SURPLUS skip that survives into the re-listed choices. Before the fix
        // this surplus skip stuck at the head and the `choose 3` below never
        // settled (the send would hit the settle cap as a timeout).
        await harness.send("skip");

        // The regression assertion: `choose 3` is applied and settles with its
        // own diff rather than waiting behind the wedged skip forever.
        const lines = await harness.send("choose 3");
        expect(
          cmds(lines).some((c) => c.text === "choose 3"),
          "choose 3 was echoed",
        ).toBe(true);
        const chooseDiffs = diffs(lines).filter((d) => d.cmd === "choose 3");
        expect(
          chooseDiffs.length,
          "choose 3 settled with its own diff (the head was not wedged)",
        ).toBeGreaterThanOrEqual(1);
        // The fix must not surface a busy/dropped watchdog line for this path.
        expect(
          errs(lines).some((e) => /^busy/i.test(e.text)),
          "no busy watchdog line fired",
        ).toBe(false);
      } finally {
        await harness.stop();
      }
    });
  } else {
    it("the golden transcript drains the surplus skip and applies `choose 3`", () => {
      const path = resolve(HERE, "fixtures", "converse-leftover-skip.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
      const lines = parseStream(raw.lines.join("\n"));

      // The surplus skip is echoed with the same `A11Y_CMD skip` convention
      // takeQueuedSkip() uses, and carries no error and no state change.
      const cmdTexts = cmds(lines).map((c) => c.text);
      expect(
        cmdTexts.filter((t) => t === "skip").length,
        "both the reply's drained skip and the surplus skip are echoed",
      ).toBe(2);

      // Crucially, `choose 3` is echoed AFTER the surplus skip, proving the
      // head advanced past the skip instead of sticking on it.
      const skipIdx = cmdTexts.lastIndexOf("skip");
      const choose3Idx = cmdTexts.indexOf("choose 3");
      expect(choose3Idx, "choose 3 was echoed").toBeGreaterThanOrEqual(0);
      expect(
        choose3Idx,
        "choose 3 was echoed after the surplus skip, not blocked by it",
      ).toBeGreaterThan(skipIdx);

      // And `choose 3` settled with its own diff.
      const choose3Diffs = diffs(lines).filter((d) => d.cmd === "choose 3");
      expect(
        choose3Diffs.length,
        "choose 3 settled with exactly one diff",
      ).toBe(1);
      expect(choose3Diffs[0]!.changed).toBe(true);

      // The dead state would have surfaced a busy watchdog line and never a
      // choose-3 diff; neither of those regressions is present here.
      expect(
        errs(lines).some((e) => /^busy/i.test(e.text)),
        "no busy watchdog line in the fixed transcript",
      ).toBe(false);
    });
  }
});
