// @vitest-environment jsdom
// LiveRegion.interrupt: cut off a screen reader still reading a long polite
// line by changing the assertive region silently. Measured on VoiceOver +
// Safari: only an assertive-region change stops it; two invisible characters
// stop it within about 250 ms and say nothing, while a single invisible
// character is read by name.
import { beforeEach, describe, expect, it } from "vitest";
import { ChoiceMenu } from "../src/ui/choice-menu.js";
import { LiveRegion } from "../src/ui/live-region.js";
import { Narrator } from "../src/ui/narrator.js";

const LONG = "A long line that is still being read aloud by the reader.";
const NBSP2 = "\u00a0\u00a0";
const ZWSP2 = "\u200b\u200b";

describe("LiveRegion.interrupt", () => {
  let polite: HTMLElement;
  let assertive: HTMLElement;
  let transcript: HTMLElement;
  let time: number;
  let live: LiveRegion;

  beforeEach(() => {
    document.body.innerHTML = `<div id="log" role="log" aria-live="polite"></div><div id="int" aria-live="assertive"></div><div id="tr"></div>`;
    polite = document.getElementById("log")!;
    assertive = document.getElementById("int")!;
    transcript = document.getElementById("tr")!;
    time = 1000;
    live = new LiveRegion(polite, transcript, undefined, assertive, () => time);
  });

  it("writes two invisible characters when a long line was announced just now", () => {
    live.announce("Pick a reply, 4 options. ".repeat(10));
    time += 100;
    expect(live.interrupt()).toBe(true);
    expect(assertive.textContent).toBe(NBSP2);
    expect(assertive.textContent).not.toContain("Picked");
    // The polite region and the last line are untouched.
    expect(polite.textContent).toContain("Pick a reply");
    expect(live.lastLine()).toContain("Pick a reply");
  });

  it("alternates the two pairs so consecutive cuts always change the content", () => {
    live.announce(LONG);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(live.interrupt()).toBe(true);
      seen.push(assertive.textContent!);
    }
    expect(seen).toEqual([NBSP2, ZWSP2, NBSP2, ZWSP2]);
    for (const s of seen) {
      expect(s.length).toBe(2);
      expect(s).not.toContain("\u2060");
    }
  });

  it("does not add a line-history or transcript entry", () => {
    live.announce("First line.");
    live.announce(LONG);
    const before = transcript.children.length;
    expect(live.interrupt()).toBe(true);
    expect(transcript.children.length).toBe(before);
    expect(live.lastLine()).toBe(LONG);
    // Shift+R still steps back to the real previous line, not the cut.
    live.stepBack();
    expect(polite.textContent).toBe("Earlier: First line.");
    // R still repeats the real last line.
    live.repeat();
    expect(polite.textContent).toBe(LONG);
  });

  it("does nothing when the last line was short and old", () => {
    live.announce("Ok.");
    time += 5000; // 3 chars x 65 ms = 195 ms window
    expect(live.interrupt()).toBe(false);
    expect(assertive.textContent).toBe("");
  });

  it("does nothing before any line was announced", () => {
    expect(live.interrupt()).toBe(false);
    expect(assertive.textContent).toBe("");
  });

  it("caps the window at 15000 ms", () => {
    live.announce("x".repeat(5000));
    time += 15000;
    expect(live.interrupt()).toBe(false);
  });

  it("still cuts just inside the window", () => {
    live.announce("x".repeat(100)); // 6500 ms window
    time += 6499;
    expect(live.interrupt()).toBe(true);
  });

  it("writes an explicit word, repeating it via the marker", () => {
    live.announce(LONG);
    expect(live.interrupt("Picked.")).toBe(true);
    const first = assertive.textContent;
    expect(live.interrupt("Picked.")).toBe(true);
    const second = assertive.textContent;
    expect(second).not.toBe(first);
    expect(first!.replace(/\u2060/g, "")).toBe("Picked.");
    expect(second!.replace(/\u2060/g, "")).toBe("Picked.");
  });

  it("returns false when there is no assertive region", () => {
    const bare = new LiveRegion(polite, undefined, undefined, undefined, () => time);
    bare.announce(LONG);
    expect(bare.interrupt()).toBe(false);
  });
});

describe("ChoiceMenu interrupt callback", () => {
  it("chooseAt calls interrupt before choose", () => {
    document.body.innerHTML = `<div id="game" tabindex="-1"></div><div id="m"></div>`;
    const order: string[] = [];
    const menu = new ChoiceMenu(document.getElementById("m")!, {
      announce: () => {},
      choose: () => order.push("choose"),
      returnToList: () => {},
      interrupt: () => order.push("interrupt"),
    });
    menu.openWith([
      { n: 1, text: "HELLO." },
      { n: 2, text: "GOODBYE." },
    ]);
    menu.chooseCurrent();
    expect(order).toEqual(["interrupt", "choose"]);
  });
});

describe("Narrator onVoicedSuppressed interrupt wiring", () => {
  it("a suppressed voiced line triggers live.interrupt through the callback", () => {
    document.body.innerHTML = `<div id="log" role="log"></div><div id="int" aria-live="assertive"></div>`;
    const polite = document.getElementById("log")!;
    const assertive = document.getElementById("int")!;
    const time = 1000;
    const live = new LiveRegion(polite, undefined, undefined, assertive, () => time);
    let cuts = 0;
    const real = live.interrupt.bind(live);
    live.interrupt = (word?: string): boolean => {
      cuts += 1;
      return real(word);
    };
    // Mirrors the wiring in main.ts.
    const narrator = new Narrator(live, {
      readVoiced: () => false,
      onVoicedSuppressed: () => {
        live.interrupt();
      },
    });
    narrator.announce(LONG);
    narrator.text("Welcome to my castle.", true);
    expect(cuts).toBe(1);
    expect(assertive.textContent).toBe(NBSP2);
    // The voiced line stayed out of the polite region.
    expect(polite.textContent).toBe(LONG);
  });
});
