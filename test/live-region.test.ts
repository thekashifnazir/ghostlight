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
