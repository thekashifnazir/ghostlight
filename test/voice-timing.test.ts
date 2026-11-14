// @vitest-environment jsdom
// Voice timing: the screen reader never talks over an actor. While an actor's
// recorded line plays (A11Y_VTEXT until A11Y_VEND), live-region writes are held
// and written once the clip ends, a key releases the hold, or a safety timer
// fires. Bookkeeping (R, Shift+R, transcript) is never held.
import { beforeEach, describe, expect, it } from "vitest";
import { parseA11yLine } from "../src/engine/a11y-lines.js";
import { LiveRegion } from "../src/ui/live-region.js";

/** Strip the invisible repeat marker setRegion may append. */
const text = (el: HTMLElement): string => (el.textContent ?? "").replace(/⁠/g, "");

describe("A11Y_VEND decoding", () => {
  it("parses to a voiceEnd event", () => {
    expect(parseA11yLine("A11Y_VEND")).toEqual({ type: "voiceEnd" });
  });
  it("still parses A11Y_VTEXT as a voiced text line", () => {
    expect(parseA11yLine("A11Y_VTEXT HELLO")).toEqual({ type: "text", line: "HELLO", voiced: true });
  });
});

describe("LiveRegion voice hold", () => {
  let region: HTMLElement;
  let transcript: HTMLElement;
  let live: LiveRegion;
  let fire: (() => void) | undefined;
  let lastMs = 0;
  let cancelled = 0;

  beforeEach(() => {
    document.body.innerHTML = `<div id="log" role="log"></div><section id="t"></section><div id="i"></div>`;
    region = document.getElementById("log")!;
    transcript = document.getElementById("t")!;
    fire = undefined;
    cancelled = 0;
    live = new LiveRegion(
      region,
      transcript,
      (fn) => fn(),
      document.getElementById("i")!,
      () => 0,
      (fn, ms) => {
        fire = fn;
        lastMs = ms;
        return () => {
          cancelled += 1;
        };
      },
    );
  });

  it("writes immediately when no voice is playing", () => {
    live.announce("Inn bar.");
    expect(text(region)).toBe("Inn bar.");
    expect(live.isVoicePlaying()).toBe(false);
  });

  it("holds writes while a voice plays and writes them on voiceEnd", () => {
    live.announce("Before.");
    live.voiceStart();
    live.announce("You picked up the book.");
    expect(text(region)).toBe("Before.");
    live.voiceEnd();
    expect(text(region)).toBe("You picked up the book.");
    expect(live.isVoicePlaying()).toBe(false);
  });

  it("joins several held lines in order so nothing functional is lost", () => {
    live.voiceStart();
    live.announce("First.");
    live.announceDialogue("Second.");
    live.voiceEnd();
    expect(text(region)).toBe("First. Second.");
  });

  it("keeps R and the transcript correct while holding", () => {
    live.voiceStart();
    live.announce("Held line.");
    expect(live.lastLine()).toBe("Held line.");
    expect(transcript.textContent).toContain("Held line.");
  });

  it("voiceEnd with nothing held leaves the region alone", () => {
    live.announce("Stays.");
    live.voiceStart();
    live.voiceEnd();
    expect(text(region)).toBe("Stays.");
  });

  it("releases on the 15 s safety timer if no voiceEnd arrives", () => {
    live.voiceStart();
    live.announce("Late line.");
    expect(lastMs).toBe(15000);
    expect(fire).toBeDefined();
    fire!();
    expect(text(region)).toBe("Late line.");
    expect(live.isVoicePlaying()).toBe(false);
  });

  it("restarts the safety timer on each voiced start", () => {
    live.voiceStart();
    live.voiceStart();
    expect(cancelled).toBe(1);
  });

  it("cancels the safety timer on voiceEnd", () => {
    live.voiceStart();
    live.voiceEnd();
    expect(cancelled).toBe(1);
  });

  it("the silent cut (interrupt) still fires while holding", () => {
    // A long readout was just written (the clock is frozen at 0, so the screen
    // reader is still reading it) when an actor starts: the cut must not be held.
    live.announce("A long room readout that the screen reader is still reading aloud.");
    live.voiceStart();
    expect(live.interrupt()).toBe(true);
    expect(document.getElementById("i")!.textContent).toMatch(/\u034f/);
  });
});
