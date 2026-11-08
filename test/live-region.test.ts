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
      expect(region.textContent).toBe("Earlier: One.");
    });

    it("remembers at most 20 earlier lines", () => {
      // Announce 22 lines: "L0".."L21". The current line is "L21"; the earlier
      // lines are L20..L0, but only the newest 20 (L20..L1) are kept.
      for (let i = 0; i < 22; i++) live.announce(`L${i}`);
      // Step back 25 times; it should stop at the oldest kept line, L1.
      for (let i = 0; i < 25; i++) live.stepBack();
      expect(region.textContent).toBe("Earlier: L1");
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
