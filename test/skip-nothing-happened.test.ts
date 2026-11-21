// Escape sends `skip`. A skip that changes nothing used to say "Nothing
// happened.", so pressing Escape a few times said it a few times, and an
// Escape pressed during the well scene replaced "Chapter 3: Below the well."
// in the single-line live region before NVDA spoke it (Edge, live 7bdf563b).
//
// The engine layer settles a skip with a changed:false diff even when the skip
// cut a line or a scene short, so "Nothing happened." was often wrong. A skip
// with nothing to skip stays quiet, and R still repeats the last real line.
import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { Narrator, type NarratorLive } from "../src/ui/narrator.js";

function recorder(): NarratorLive & { lines: string[] } {
  const lines: string[] = [];
  return { lines, announce: (t) => void lines.push(t) };
}

function quiet(cmd: string): Diff {
  return { cmd, changed: false };
}

/** Send one command through the narrator the way main.ts does. */
function settle(narrator: Narrator, diff: Diff): void {
  narrator.beginCommand();
  narrator.maybeNothingHappened(diff, narrator.said(diff));
}

describe("a skip that changes nothing", () => {
  it("never says 'Nothing happened.', however many times Escape is pressed", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    for (let i = 0; i < 4; i++) settle(narrator, quiet("skip"));
    expect(live.lines).toEqual([]);
  });

  it("still speaks a line the skip's diff carries", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    settle(narrator, {
      cmd: "skip",
      changed: true,
      said: [{ color: "white", text: "The door slams shut." }],
    });
    expect(live.lines).toEqual(["The door slams shut."]);
  });

  it("leaves the last real line for R: a no-op take still says it, the skips after add nothing", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    settle(narrator, quiet("take 99"));
    settle(narrator, quiet("skip"));
    settle(narrator, quiet("skip"));
    expect(live.lines).toEqual(["Nothing happened."]);
  });

  it("a real no-op action after a skip still gets its 'Nothing happened.'", () => {
    const live = recorder();
    const narrator = new Narrator(live);
    settle(narrator, quiet("skip"));
    settle(narrator, quiet("push 12"));
    expect(live.lines).toEqual(["Nothing happened."]);
  });
});
