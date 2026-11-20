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

  // Examine announces the pack's description and then sends `look`; the hero
  // speaks his look line 0.3 to 1 s later (measured on live, 18 Nov). The
  // description is held for the reply so the two are not heard at once.
  describe("reply hold (examine)", () => {
    it("holds the description through the hero's line and writes it at the end", () => {
      live.holdForReply();
      live.announce("A skull sitting on top of the piano.");
      expect(text(region)).toBe("");
      live.voiceStart(); // A11Y_VTEXT
      live.releaseReplyHold(); // a diff or error mid-line must not release
      expect(text(region)).toBe("");
      live.voiceEnd(); // A11Y_VEND
      expect(text(region)).toBe("A skull sitting on top of the piano.");
      live.releaseReplyHold(); // the diff after VEND is a no-op
      expect(text(region)).toBe("A skull sitting on top of the piano.");
    });

    it("writes the description with the diff's lines when nobody speaks", () => {
      live.holdForReply();
      live.announce("A piano.");
      live.announce("Nothing happened.");
      expect(text(region)).toBe("");
      live.releaseReplyHold();
      expect(text(region)).toBe("A piano. Nothing happened.");
      expect(live.isVoicePlaying()).toBe(false);
    });

    it("keeps R correct while the description is held", () => {
      live.holdForReply();
      live.announce("A piano.");
      expect(live.lastLine()).toBe("A piano.");
    });

    it("is released by the safety timer if no reply comes", () => {
      live.holdForReply();
      live.announce("A piano.");
      fire!();
      expect(text(region)).toBe("A piano.");
    });

    it("a second examine while the hero still answers the first waits for its own look", () => {
      // Look 1: the hero's line is playing.
      live.holdForReply("look 204");
      live.announce("A bin.");
      live.voiceStart(); // VTEXT "IT'S A BIN"
      // Down on the next thing: the key releases the playing line's hold.
      live.voiceEnd();
      expect(text(region)).toBe("A bin.");
      live.holdForReply("look 201");
      live.announce("A small blackboard.");
      live.engineVoiceEnd(); // look 1's VEND arrives after the new hold
      expect(text(region)).toBe("A bin.");
      live.releaseReplyHold("look 204"); // look 1's diff
      expect(text(region)).toBe("A bin.");
      live.voiceStart(); // look 2's VTEXT
      live.engineVoiceEnd(); // look 2's VEND
      expect(text(region)).toBe("A small blackboard.");
    });

    it("its own look's diff releases it when nobody speaks", () => {
      live.holdForReply("look 201");
      live.announce("A small blackboard.");
      live.releaseReplyHold("look 204");
      expect(text(region)).toBe("");
      live.releaseReplyHold("look 201");
      expect(text(region)).toBe("A small blackboard.");
    });

    it("an error (no command named) releases it", () => {
      live.holdForReply("look 201");
      live.announce("A small blackboard.");
      live.releaseReplyHold();
      expect(text(region)).toBe("A small blackboard.");
    });

    it("an engine voice end with no reply hold writes as before", () => {
      live.voiceStart();
      live.announce("Held.");
      live.engineVoiceEnd();
      expect(text(region)).toBe("Held.");
    });

    it("releaseReplyHold leaves a voice-only hold alone", () => {
      live.voiceStart();
      live.announce("Held.");
      live.releaseReplyHold();
      expect(text(region)).toBe("");
      live.voiceEnd();
      expect(text(region)).toBe("Held.");
    });
  });
});
