// A `skip` with nothing to skip must settle with a diff, not hang.
//
// The skip hook (engine/a11y.cpp A11yLayer::onUpdateEvents) runs every frame
// and drains any queued `skip` through raiseSkip(), including when the main
// loop is idle and there is nothing to skip. Before the fix it emitted only the
// `A11Y_CMD skip` echo and NO settling line, so a no-op `skip` produced an echo
// but never an A11Y_DIFF. An external reader that waits for the settle marker
// (the drascula-mcp native transport, scripts/drive.sh) then waited its full
// 60s timeout for every bare `skip`.
//
// The fix: when onUpdateEvents drains a skip with no command in flight
// (_inRunCommand clear — the main loop is idle, so nothing is being skipped),
// it emits the no-op settle `A11Y_DIFF {"cmd":"skip","changed":false}` itself,
// giving the one-echo-plus-one-settle shape every other command has.
//
//   * Default (no engine build): assert the golden over-skip transcript, which
//     records real native no-op skips settling as changed:false diffs with no
//     state move. This is the deterministic evidence available with no engine.
//   * GHOSTLIGHT_NATIVE=1: boot the real native engine fresh to the tavern and
//     send one bare `skip` with nothing to skip. Under a short settle cap, the
//     send resolves with the skip's diff (the fix) rather than throwing a
//     timeout (the bug). Asserts the diff is changed:false and moved nothing.

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

/** All diffs in the stream, in order. */
function diffs(lines: A11yLine[]): Diff[] {
  return lines.filter((l): l is Diff => l.kind === "diff");
}

/** Assert one skip diff is a clean no-op: changed:false and no state move. */
function expectNoOpSkipDiff(d: Diff): void {
  expect(d.cmd).toBe("skip");
  expect(d.changed, "a no-op skip must not change state").toBe(false);
  expect(d.room, "a no-op skip must not change room").toBeUndefined();
  expect(d.chapter, "a no-op skip must not change chapter").toBeUndefined();
  expect(d.invAdded).toBeUndefined();
  expect(d.invRemoved).toBeUndefined();
  expect(d.flags).toBeUndefined();
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

describe("a no-op skip settles with a diff instead of hanging", () => {
  if (useNative()) {
    it("a bare `skip` at the tavern resolves with a changed:false diff (no 60s hang)", async () => {
      // Boot fresh (chapter 1, tavern); no cutscene/speech is blocking, so a
      // `skip` here has nothing to skip. A short settle cap means a regression
      // to the old behaviour (no diff) fails fast as a timeout rather than
      // waiting the full 60s.
      const harness = new NativeHarness({
        ...nativePaths(),
        label: "native:skip-noop",
        settleMs: 20_000,
      });
      try {
        const start = await harness.start();
        expect(start.chapter).toBe(1);

        // Before the fix this send would throw "timed out waiting for the
        // settle of \"skip\""; after it, it resolves with the skip's diff.
        const lines = await harness.send("skip");

        // The echo and exactly one settling diff, as every command emits.
        expect(
          lines.filter((l) => l.kind === "cmd" && l.text === "skip").length,
          "the skip was echoed",
        ).toBeGreaterThanOrEqual(1);
        const skipDiffs = diffs(lines).filter((d) => d.cmd === "skip");
        expect(skipDiffs.length, "exactly one skip diff settled the command").toBe(1);
        expectNoOpSkipDiff(skipDiffs[0]!);
      } finally {
        await harness.stop();
      }
    });
  } else {
    it("the golden over-skip transcript records no-op skips as changed:false diffs", () => {
      // The over-skip run floods bare skips into chapter 2's idle main loop;
      // each must settle as a changed:false diff that moved nothing — the same
      // settle a bare `skip` gets. If a no-op skip emitted no diff, these would
      // be absent and the transcript would carry only the echoes.
      const path = resolve(HERE, "fixtures", "over-skip-crossing.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
      const lines = parseStream(raw.lines.join("\n"));

      const skipDiffs = diffs(lines).filter((d) => d.cmd === "skip");
      expect(
        skipDiffs.length,
        "no-op skips settle with a changed:false diff",
      ).toBeGreaterThan(0);
      for (const d of skipDiffs) expectNoOpSkipDiff(d);
    });
  }
});
