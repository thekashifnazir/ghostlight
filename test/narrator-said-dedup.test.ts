// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Diff } from "../src/engine/adapter.js";
import { LiveRegion } from "../src/ui/live-region.js";
import { Narrator } from "../src/ui/narrator.js";

// The NVDA recording of the live build caught this: during a talk (bartender,
// `talk 52`) the engine streams each dialogue line as it says it (A11Y_TEXT →
// narrator.text), and then the settling A11Y_DIFF carries the WHOLE
// conversation again in its `said` array. The old narrator de-duped a `said`
// line only against the single last line it announced, so the final repeat was
// dropped but the other N−1 were re-announced in one burst — NVDA read it as a
// jumble and repeated the last line, and R (repeat) / Shift+R (history) were
// flooded with the whole conversation.
//
// The fix: a `said` line already STREAMED live during the same command (matched
// by text, in order) is not announced again; only `said` lines that were NOT
// streamed reach the live region. These tests pin that against the REAL
// LiveRegion so the live-region history (Shift+R) is exercised too — each line
// must land in the history exactly once.

/**
 * A LiveRegion stand-in that records every announced line in order, so a test
 * can assert the exact sequence a screen reader got. `last` is the newest.
 */
class FakeLive {
  lines: string[] = [];
  announce(text: string): void {
    this.lines.push(text);
  }
  get last(): string | undefined {
    return this.lines[this.lines.length - 1];
  }
}

/** A talk diff whose `said` carries the given conversation lines (white). */
function talkDiff(lines: string[]): Diff {
  return {
    cmd: "talk 52",
    changed: false,
    said: lines.map((text) => ({ color: "white", text })),
  };
}

// The 20 lines of the bartender conversation, as the engine both streams them
// (one A11Y_TEXT each) and then repeats them in the settle diff's `said`.
const CONVERSATION = Array.from(
  { length: 20 },
  (_, i) => `Bartender line ${i + 1}.`,
);

describe("narrator: streamed dialogue is not re-announced by the settle diff", () => {
  it("streams each line once, then the repeating diff adds nothing", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    for (const line of CONVERSATION) narrator.text(line); // engine streams them
    expect(live.lines).toEqual(CONVERSATION); // 20 lines, in order

    // The settle diff repeats the whole conversation in `said`.
    narrator.said(talkDiff(CONVERSATION));

    // No line was announced a second time: the live region saw exactly the 20
    // streamed lines, once each, not a 20-line burst on top.
    expect(live.lines).toEqual(CONVERSATION);
  });

  it("announces only a said line that was NOT streamed", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    for (const line of CONVERSATION) narrator.text(line);

    // The diff repeats the whole conversation AND carries one new trailing line
    // the engine never streamed (e.g. a closing "HE TURNS AWAY.").
    const closing = "HE TURNS AWAY.";
    narrator.said(talkDiff([...CONVERSATION, closing]));

    // Only the new line is added; the 20 streamed lines are not repeated.
    expect(live.lines).toEqual([...CONVERSATION, closing]);
  });

  it("a non-streamed one-line reply still speaks (nothing was streamed)", () => {
    // The chapter-crossing / plain-reply path: no text() stream, the diff's
    // `said` is the only source, so it must be announced.
    const live = new FakeLive();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    narrator.said(talkDiff(["I DON'T HAVE A ROOM YET."]));

    expect(live.lines).toEqual(["I DON'T HAVE A ROOM YET."]);
  });

  it("a fresh command does not carry over the previous command's stream", () => {
    const live = new FakeLive();
    const narrator = new Narrator(live);

    // First command streams two lines.
    narrator.beginCommand();
    narrator.text("First line A.");
    narrator.text("First line B.");

    // A new command starts and streams nothing; its diff carries a line that
    // matches command 1's FIRST streamed line. Because beginCommand() reset the
    // per-command stream buffer, that stale line no longer suppresses the diff,
    // so the diff's line is announced.
    narrator.beginCommand();
    narrator.said(talkDiff(["First line A."]));

    expect(live.lines).toEqual([
      "First line A.", // streamed by command 1
      "First line B.", // streamed by command 1
      "First line A.", // announced by command 2's diff (buffer was reset)
    ]);
  });
});

describe("narrator + real LiveRegion: history holds each line once", () => {
  function realLive(): { region: HTMLElement; live: LiveRegion } {
    document.body.innerHTML = `<div id="log" role="log"></div>`;
    const region = document.getElementById("log")!;
    return { region, live: new LiveRegion(region) };
  }

  it("Shift+R walks back through each conversation line exactly once", () => {
    const { region, live } = realLive();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    for (const line of CONVERSATION) narrator.text(line);
    narrator.said(talkDiff(CONVERSATION)); // the repeating diff adds nothing

    // The newest line is the last conversation line, announced once.
    expect(live.lastLine()).toBe(CONVERSATION[CONVERSATION.length - 1]);

    // Step back through the whole history: each earlier line appears once, in
    // reverse order, with no duplicate burst from the diff. The current line
    // (last) is line 20; stepping back gives 19, 18, … 1.
    const recalled: string[] = [];
    for (let i = 0; i < CONVERSATION.length - 1; i += 1) {
      live.stepBack();
      recalled.push(region.textContent ?? "");
    }
    const expected = CONVERSATION.slice(0, CONVERSATION.length - 1)
      .reverse()
      .map((line) => `Earlier: ${line}`);
    expect(recalled).toEqual(expected);
  });

  it("R repeats the single last line, not the whole conversation", () => {
    const { region, live } = realLive();
    const narrator = new Narrator(live);

    narrator.beginCommand();
    for (const line of CONVERSATION) narrator.text(line);
    narrator.said(talkDiff(CONVERSATION));

    region.textContent = ""; // simulate the region read and cleared
    live.repeat();
    expect(region.textContent).toBe(CONVERSATION[CONVERSATION.length - 1]);
  });
});
