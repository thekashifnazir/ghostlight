// Room 22's cut branch stays gone (found while checking a tester's 20 Nov report).
//
// The bug: behind the tree (room 22, chapter 4) the room list still offered the
// branch after it had been cut and carried. room_22 hides hotspot 140 when the
// axe cuts it (visible[1] = 0, flags[24] = 1), but updateVisible() has a rule
// that shows visible[1] again on every visit once the magpie has flown
// (flags[26]), and nothing for flags[24].
//
// The fix (engine/hooks.patch, objects.cpp updateVisible()): in room 22, once
// flags[24] is set, the branch stays hidden.
//
//   * Default (no engine build): assert the golden transcript
//     (fixtures/cut-branch.json), recorded from a native run with the fix.
//   * GHOSTLIGHT_NATIVE=1: load the walkthrough's chapter 4 save in slot 17
//     (castle grounds, room 21, branch cut and carried, magpie gone) and walk
//     behind the tree (100).

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

const BRANCH = 140;

function nativePaths() {
  return {
    binary: resolve(REPO_ROOT, "vendor", "scummvm", "scummvm"),
    gamePath: resolve(REPO_ROOT, "vendor", "game", "drascula"),
    extraPath: resolve(REPO_ROOT, "vendor", "scummvm", "dists", "engine-data"),
    savePath: process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine",
  };
}

/** Checks shared by the native run and the golden transcript. */
function expectBranchHidden(lines: A11yLine[]): void {
  const diff = lines.find(
    (l): l is Extract<A11yLine, { kind: "diff" }> => l.kind === "diff" && l.cmd === "walk 100",
  );
  expect(diff, "walk 100 settled with a diff").toBeDefined();
  expect(diff?.room).toEqual([21, 22]);
  const branch = (diff?.objects ?? []).filter((o) => o.num === BRANCH);
  expect(branch.length, "the branch hotspot is still in the room's table").toBeGreaterThan(0);
  for (const o of branch) expect(o.visible, "the cut branch is hidden").toBe(false);
}

describe("room 22's cut branch stays hidden", () => {
  if (useNative()) {
    it("walk 100 from the castle grounds lists no branch once it's cut", async () => {
      const harness = new NativeHarness({
        ...nativePaths(),
        saveSlot: 17,
        label: "native:cut-branch",
      });
      try {
        const start = await harness.start();
        expect(start.room).toBe(21);
        expectBranchHidden(await harness.send("walk 100"));
      } finally {
        await harness.stop();
      }
    }, 300_000);
  } else {
    it("the golden transcript shows the branch hidden", () => {
      const path = resolve(HERE, "fixtures", "cut-branch.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
      expectBranchHidden(parseStream(raw.lines.join("\n")));
    });
  }
});
