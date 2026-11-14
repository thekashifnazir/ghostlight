// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Hotspot } from "../src/model/hotspot-list.js";
import { LiveRegion } from "../src/ui/live-region.js";

function hs(partial: Partial<Hotspot> & { name: string; kind: Hotspot["kind"] }): Hotspot {
  return {
    num: 1,
    rect: [0, 0, 1, 1],
    walkTo: [0, 0],
    ...partial,
  };
}

describe("LiveRegion", () => {
  let region: HTMLElement;
  let transcript: HTMLElement;
  let live: LiveRegion;

  beforeEach(() => {
    document.body.innerHTML = `<div id="log" role="log"></div><section id="t"></section>`;
    region = document.getElementById("log")!;
    transcript = document.getElementById("t")!;
    live = new LiveRegion(region, transcript);
  });

  it("announce replaces content rather than appending", () => {
    live.announce("First line.");
    expect(region.textContent).toBe("First line.");
    live.announce("Second line.");
    // The region holds only the newest line (interrupt, not queue).
    expect(region.textContent).toBe("Second line.");
  });

  it("mirrors each line to the transcript, keeping history there", () => {
    live.announce("One.");
    live.announce("Two.");
    const lines = Array.from(transcript.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(lines).toEqual(["One.", "Two."]);
  });

  it("repeat re-announces the last line", () => {
    live.announce("A line to repeat.");
    region.textContent = ""; // simulate the region having been read and cleared
    live.repeat();
    expect(region.textContent).toBe("A line to repeat.");
    expect(live.lastLine()).toBe("A line to repeat.");
  });

  describe("line history (Shift+R)", () => {
    it("steps back through earlier lines, prefixed with 'Earlier:'", () => {
      live.announce("One.");
      live.announce("Two.");
      live.announce("Three."); // current line

      live.stepBack();
      expect(region.textContent).toBe("Earlier: Two.");
      live.stepBack();
      expect(region.textContent).toBe("Earlier: One.");
    });

    it("does not disturb the last line: R still repeats the real last line", () => {
      live.announce("One.");
      live.announce("Two.");
      live.stepBack(); // walks back to "One."
      expect(region.textContent).toBe("Earlier: One.");
      expect(live.lastLine()).toBe("Two.");
      live.repeat();
      expect(region.textContent).toBe("Two.");
    });

    it("stays on the oldest remembered line past the start of history", () => {
      live.announce("One.");
      live.announce("Two.");
      live.stepBack(); // "One."
      live.stepBack(); // already oldest; stays on "One."
      live.stepBack();
      // Repeated step-backs at the oldest line toggle an invisible marker so
      // each one re-reads (Fix 3); strip it to assert the visible recall text.
      expect(region.textContent?.replace(/\u2060$/, "")).toBe("Earlier: One.");
    });

    it("remembers at most 20 earlier lines", () => {
      // Announce 22 lines: "L0".."L21". The current line is "L21"; the earlier
      // lines are L20..L0, but only the newest 20 (L20..L1) are kept.
      for (let i = 0; i < 22; i++) live.announce(`L${i}`);
      // Step back 25 times; it should stop at the oldest kept line, L1.
      for (let i = 0; i < 25; i++) live.stepBack();
      expect(region.textContent?.replace(/\u2060$/, "")).toBe("Earlier: L1");
    });

    it("resetHistoryCursor makes the next Shift+R start from the most recent earlier line", () => {
      live.announce("One.");
      live.announce("Two.");
      live.announce("Three.");
      live.stepBack(); // "Two."
      live.stepBack(); // "One."
      expect(region.textContent).toBe("Earlier: One.");
      live.resetHistoryCursor();
      live.stepBack(); // starts again from the most recent earlier line
      expect(region.textContent).toBe("Earlier: Two.");
    });

    it("a new announced line resets the back cursor", () => {
      live.announce("One.");
      live.announce("Two.");
      live.stepBack(); // "One."
      live.announce("Three."); // new line resets the cursor
      live.stepBack();
      expect(region.textContent).toBe("Earlier: Two.");
    });

    it("stepBack is a no-op with no earlier lines", () => {
      live.announce("Only line.");
      live.stepBack();
      // No earlier line to recall; the region is untouched.
      expect(region.textContent).toBe("Only line.");
    });

    it("mirrors recalled lines to the transcript too", () => {
      live.announce("One.");
      live.announce("Two.");
      live.stepBack();
      const lines = Array.from(transcript.querySelectorAll("p")).map(
        (p) => p.textContent,
      );
      expect(lines).toEqual(["One.", "Two.", "Earlier: One."]);
    });
  });

  it("composes the N of M focus line", () => {
    expect(LiveRegion.focusLine("skull", 2, 7)).toBe("skull, 3 of 7");
  });

  describe("repeat re-reads every time, even for identical text (Fix 3)", () => {
    // A polite live region only re-announces when its text actually changes.
    // A screen reader reading the SAME string twice is silent the second time,
    // so pressing R twice used to read the line only once. The region write now
    // forces a DOM change (an invisible marker toggled on identical writes), so
    // every R is read.
    const WJ = "\u2060"; // the invisible WORD JOINER marker

    it("R twice produces two distinct DOM values (two reads)", () => {
      live.announce("A repeatable line.");
      const first = region.textContent;
      live.repeat();
      const afterFirstR = region.textContent;
      live.repeat();
      const afterSecondR = region.textContent;
      // Each R changed the DOM, so a polite region re-reads each time.
      expect(afterFirstR).not.toBe(first);
      expect(afterSecondR).not.toBe(afterFirstR);
      // The visible, spoken text is unchanged apart from the invisible marker.
      expect(afterFirstR?.replace(WJ, "")).toBe("A repeatable line.");
      expect(afterSecondR?.replace(WJ, "")).toBe("A repeatable line.");
    });

    it("the invisible marker never leaks into lastLine, history or the transcript", () => {
      live.announce("Clean line.");
      live.repeat(); // adds the marker to the region only
      // lastLine is the clean text (so R and recaps stay correct).
      expect(live.lastLine()).toBe("Clean line.");
      expect(live.lastLine()).not.toContain(WJ);
      // The transcript mirror carries the clean text, no marker.
      const lines = Array.from(transcript.querySelectorAll("p")).map(
        (p) => p.textContent,
      );
      for (const l of lines) expect(l).not.toContain(WJ);
      // A following Shift+R step-back recalls the clean earlier line, no marker.
      live.announce("Second clean line.");
      live.stepBack();
      expect(region.textContent?.replace(WJ, "")).toBe("Earlier: Clean line.");
    });

    it("a genuinely new, distinct line is written clean (no marker)", () => {
      live.announce("First.");
      live.announce("Second.");
      // Distinct consecutive lines carry no marker — only identical repeats do.
      expect(region.textContent).toBe("Second.");
    });

    it("announcing the same text twice in a row still changes the DOM", () => {
      live.announce("Same line.");
      const first = region.textContent;
      live.announce("Same line.");
      const second = region.textContent;
      expect(second).not.toBe(first);
      expect(second?.replace(WJ, "")).toBe("Same line.");
      // History records the clean duplicate, not the marker.
      expect(live.lastLine()).toBe("Same line.");
    });
  });

  it("composes the room announcement: name, short, things, exits", () => {
    const hotspots: Hotspot[] = [
      hs({ name: "bartender", kind: "npc" }),
      hs({ name: "skull", kind: "object" }),
      hs({ name: "stone arch to the back room", kind: "exit" }),
    ];
    const text = LiveRegion.roomAnnouncement({
      name: "Inn bar",
      short: "A stone tavern.",
      hotspots,
    });
    expect(text).toContain("Inn bar");
    expect(text).toContain("A stone tavern.");
    expect(text).toContain("Here: bartender and skull.");
    expect(text).toContain("Exits: stone arch to the back room.");
  });

  it("speaks the worth-a-look nudge straight after the room name", () => {
    const text = LiveRegion.roomAnnouncement({
      name: "Inn bar",
      nudge: "Worth a look: It's late, and you'll need somewhere to sleep.",
      short: "A stone tavern.",
      hotspots: [hs({ name: "bartender", kind: "npc" }), hs({ name: "stairs", kind: "exit" })],
    });
    expect(text).toBe(
      "Inn bar. Worth a look: It's late, and you'll need somewhere to sleep. A stone tavern. Here: bartender. Exits: stairs.",
    );
  });

  it("falls back when the room has no pack name or description", () => {
    const text = LiveRegion.roomAnnouncement({
      name: undefined,
      short: undefined,
      hotspots: [],
    });
    expect(text).toContain("A room");
    expect(text).toContain("Nothing here to use.");
    expect(text).toContain("No obvious way out.");
  });
});
