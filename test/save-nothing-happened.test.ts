import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { Narrator, type NarratorLive } from "../src/ui/narrator.js";

/** A live-region stand-in that records every announced line. */
function recorder(): NarratorLive & { lines: string[] } {
  const lines: string[] = [];
  return { lines, announce: (t) => void lines.push(t) };
}

/** A minimal changed:false diff for the given command. */
function quietDiff(cmd: string): Diff {
  return { cmd, changed: false };
}

describe("a save never says 'Nothing happened.' (save-progress follow-up)", () => {
  it("suppresses 'Nothing happened.' for a save diff", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    // A `save 1` settles with a changed:false diff (saving alters no room
    // state). The save outcome is the manager's "Saved." / failure line; the
    // narrator must not add "Nothing happened." for the save.
    const diff = quietDiff("save 1");
    const isLook = narrator.said(diff); // false
    narrator.maybeNothingHappened(diff, isLook);
    expect(live.lines).not.toContain("Nothing happened.");
    expect(live.lines).toEqual([]);
  });

  it("suppresses it for the autosave slot too", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    const diff = quietDiff("save 0");
    narrator.maybeNothingHappened(diff, narrator.said(diff));
    expect(live.lines).not.toContain("Nothing happened.");
  });

  it("still says 'Nothing happened.' for a real no-op action that is not a save or look", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    // A take that did nothing and said nothing is the genuine "Nothing
    // happened." case — the suppression must stay narrow to save/look.
    const diff = quietDiff("take 99");
    narrator.maybeNothingHappened(diff, narrator.said(diff));
    expect(live.lines).toEqual(["Nothing happened."]);
  });
});
