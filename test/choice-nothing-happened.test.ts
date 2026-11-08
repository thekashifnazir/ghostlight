import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { Narrator, type NarratorLive } from "../src/ui/narrator.js";

// The drunk `talk 53` bug (seen live via window.__ghostlight.lines): Enter on
// the drunk sends `talk 53`, the engine opens a choice menu and announces
// "1. HI BOSS, HOW ARE YOU? 2. …", then one millisecond later its settling
// `changed:false` diff announced "Nothing happened." — which, in the
// single-line polite live region, REPLACED the choice line, so a screen reader
// read only "Nothing happened." The fix: "Nothing happened." is spoken only
// when a command produced no diff change, no spoken text AND no choices. These
// tests replay the event sequence the player routes for that command and
// assert the newest (last announced) line is the choice line, never "Nothing
// happened."

/** A live-region stand-in that records every announced line, newest last. */
function recorder(): NarratorLive & { lines: string[] } {
  const lines: string[] = [];
  return { lines, announce: (t) => void lines.push(t) };
}

/** The drunk's opening choice menu, exactly as the choices event composes it. */
const DRUNK_CHOICES = "1. HI BOSS, HOW ARE YOU? 2. GIVE ME A DRINK. 3. GOODBYE.";

/** A `talk 53` settle diff: nothing moved, nothing said (the real-engine case). */
function talkSettleDiff(): Diff {
  return { cmd: "talk 53", changed: false };
}

describe("a talk that opens a choice menu never says 'Nothing happened.' (drunk talk 53)", () => {
  it("CHOICES then a changed:false settle -> last line is the choice line", () => {
    const live = recorder();
    const narrator = new Narrator(live);

    // The player resets the narration window when it sends the command.
    narrator.beginCommand();
    // The engine opens the conversation menu (A11Y_CHOICES -> choices event).
    narrator.choices(DRUNK_CHOICES);
    // The talk settles with a changed:false diff that carries no `said`.
    const diff = talkSettleDiff();
    const isLook = narrator.said(diff); // false
    narrator.maybeNothingHappened(diff, isLook);

    expect(live.lines).not.toContain("Nothing happened.");
    // The choice line survives as the newest (last) line a screen reader reads.
    expect(live.lines.at(-1)).toBe(DRUNK_CHOICES);
    expect(live.lines).toEqual([DRUNK_CHOICES]);
  });

  it("lead-in dialogue then CHOICES then settle -> last line is still the choice line", () => {
    const live = recorder();
    const narrator = new Narrator(live);

    // The real drunk talk plays a lead-in line, then opens the menu. Give the
    // narrator a non-empty room-label set that does NOT match the dialogue, so
    // the multi-word dialogue line is treated as real text, not a hover echo.
    narrator.setRoomLabels([], ["drunk"]);

    narrator.beginCommand();
    narrator.text("WHAT DO YOU WANT?"); // engine dialogue (A11Y_TEXT)
    narrator.choices(DRUNK_CHOICES); // then the menu opens
    const diff = talkSettleDiff();
    narrator.maybeNothingHappened(diff, narrator.said(diff));

    expect(live.lines).not.toContain("Nothing happened.");
    expect(live.lines.at(-1)).toBe(DRUNK_CHOICES);
  });

  it("a 'choice' phase alone (no choices event) also suppresses 'Nothing happened.'", () => {
    const live = recorder();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    narrator.onPhase("busy");
    narrator.onPhase("choice"); // the engine reports the menu is open
    const diff = talkSettleDiff();
    narrator.maybeNothingHappened(diff, narrator.said(diff));

    expect(live.lines).not.toContain("Nothing happened.");
    expect(live.lines).toEqual([]);
  });

  it("beginCommand clears a previous command's choice window", () => {
    const live = recorder();
    const narrator = new Narrator(live);

    // A first command opened a choice menu…
    narrator.beginCommand();
    narrator.choices(DRUNK_CHOICES);

    // …then a later, unrelated no-op command (a take that did nothing) must
    // still get its genuine "Nothing happened." — the choice window was reset.
    narrator.beginCommand();
    const diff: Diff = { cmd: "take 99", changed: false };
    narrator.maybeNothingHappened(diff, narrator.said(diff));

    expect(live.lines).toContain("Nothing happened.");
    expect(live.lines.at(-1)).toBe("Nothing happened.");
  });

  it("still says 'Nothing happened.' for a genuine no-op with no choices, text or phase", () => {
    const live = recorder();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    const diff: Diff = { cmd: "push 99", changed: false };
    narrator.maybeNothingHappened(diff, narrator.said(diff));

    expect(live.lines).toEqual(["Nothing happened."]);
  });
});
