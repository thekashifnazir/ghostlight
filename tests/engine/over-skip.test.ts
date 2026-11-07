// Task 23: cutscene over-skip guard.
//
// Extra `skip` commands arriving during a cutscene or speech loop (more skips
// than there are lines/cutscenes to end) MUST NOT leave the engine in a broken
// state. The guard (engine/a11y.cpp A11yLayer::dropSurplusSkips, called at the
// chapter-crossing point in poll() and at the receiving chapter's onStartup())
// drops the surplus — both the unconsumed kActionSkip left in the engine's
// action buffer and any extra `skip` still queued — so that once the crossing
// cutscene ends no stray skip bleeds into the next room/line and state stays
// coherent (R7.3, R7.4, gotcha 5).
//
// How this is driven. The crossing is a long cutscene (animation_2_1) advanced
// one line at a time by skips written WHILE it runs; only a live, timed skip
// feeder produces it (a skip queued before the cutscene is a harmless no-op).
// That feeder is scripts/over-skip-crossing.sh, which deliberately OVER-skips:
// it floods far more skips than the cutscene needs, then probes chapter 2.
//
//   * Default (no engine build): assert the golden transcript recorded from a
//     real native over-skip run (fixtures/over-skip-crossing.json), so the
//     guarantee is checked in the normal suite with no engine.
//   * GHOSTLIGHT_NATIVE=1: run scripts/over-skip-crossing.sh live against the
//     native build in a real window (gotcha 12) under its 60s-per-marker /
//     240s-overall cap, and assert the SAME invariants on its fresh output.
//
// Both paths assert exactly the task's contract: the chapter 1->2 crossing
// yields exactly one coherent A11Y_DIFF (chapter [1,2], room [62,14]); the
// engine is a valid chapter 2 room 14 afterward; and no stray skip bled in (a
// follow-up look in room 14 still speaks).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseStream } from "./src/parse.js";
import type { A11yLine, Diff, RoomState } from "./src/lines.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

/** True when the suite is configured to drive the real native engine. */
function useNative(): boolean {
  return process.env.GHOSTLIGHT_NATIVE === "1";
}

/** All diffs in the stream, in order. */
function diffs(lines: A11yLine[]): Diff[] {
  return lines.filter((l): l is Diff => l.kind === "diff");
}

/** The over-skip a11y lines: recorded golden transcript, or a live native run. */
function overSkipLines(): A11yLine[] {
  if (useNative()) {
    // Live: run the over-skip driver against the native build and parse its
    // captured A11Y* output. The script owns its own save path, 240s overall
    // cap and kill -9 teardown; it exits non-zero if the guard fails, which
    // surfaces here as a thrown error (test failure) with the script's stderr.
    const savePath = process.env.GHOSTLIGHT_SAVEPATH ?? "/tmp/ghostlight-engine";
    const script = resolve(REPO_ROOT, "scripts", "over-skip-crossing.sh");
    const stdout = execFileSync("bash", [script, savePath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseStream(stdout);
  }
  // Default: the golden transcript recorded from a real native over-skip run.
  const path = resolve(HERE, "fixtures", "over-skip-crossing.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as { lines: string[] };
  return parseStream(raw.lines.join("\n"));
}

describe("over-skip guard: flooding skips through the chapter 1->2 crossing", () => {
  const lines = overSkipLines();

  it("the crossing is exactly ONE coherent diff (chapter [1,2], room [62,14])", () => {
    // A surplus skip bleeding into chapter 2 could trigger a second room or
    // chapter change; there must be exactly one chapter-crossing diff.
    const crossings = diffs(lines).filter(
      (d) => d.chapter && d.chapter[0] === 1 && d.chapter[1] === 2,
    );
    expect(crossings.length, "exactly one chapter [1,2] crossing diff").toBe(1);

    const crossing = crossings[0]!;
    // It is attributed to the walk that triggered it, and carries the room move
    // and the new room's objects (R4.3).
    expect(crossing.cmd).toBe("walk 105");
    expect(crossing.room).toEqual([62, 14]);
    expect(crossing.changed).toBe(true);
    expect((crossing.objects ?? []).length).toBeGreaterThan(0);
  });

  it("every surplus skip after the crossing is a harmless no-op, not a state change", () => {
    // The flood of extra skips must each settle as changed:false with no room,
    // chapter, inventory or flag move — proof the leftover skips were dropped
    // and did not advance a line or corrupt state.
    const skipDiffs = diffs(lines).filter((d) => d.cmd === "skip");
    expect(skipDiffs.length, "surplus skips were exercised").toBeGreaterThan(0);
    for (const d of skipDiffs) {
      expect(d.changed, "a surplus skip must not change state").toBe(false);
      expect(d.room, "a surplus skip must not change room").toBeUndefined();
      expect(d.chapter, "a surplus skip must not change chapter").toBeUndefined();
      expect(d.invAdded).toBeUndefined();
      expect(d.invRemoved).toBeUndefined();
    }
  });

  it("the engine is a valid chapter 2 room 14 afterward, hero in bounds", () => {
    // The post-crossing `dump` re-emits the full room state: it must be chapter
    // 2 room 14 with the hero positioned inside the 320x200 room space (R5).
    const rooms = lines.filter((l): l is RoomState => l.kind === "room");
    const ch2 = rooms.find((r) => r.chapter === 2 && r.room === 14);
    expect(ch2, "a chapter 2 room 14 state after the crossing").toBeDefined();
    expect(ch2!.hero.x).toBeGreaterThanOrEqual(0);
    expect(ch2!.hero.x).toBeLessThanOrEqual(320);
    expect(ch2!.hero.y).toBeGreaterThanOrEqual(0);
    expect(ch2!.hero.y).toBeLessThanOrEqual(200);
  });

  it("no stray skip bled in: a follow-up look in room 14 still speaks", () => {
    // If a leftover skip had bled into chapter 2 it would have ended the
    // follow-up look's speech line, leaving its diff with no `said`. The look
    // settles as its own diff and carries a spoken line.
    const look = diffs(lines).find((d) => d.cmd === "look 202");
    expect(look, "look 202 settled as its own diff").toBeDefined();
    expect(
      (look!.said ?? []).length,
      "the follow-up look still speaks (no skip ate its line)",
    ).toBeGreaterThan(0);
  });
});
