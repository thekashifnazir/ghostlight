// @vitest-environment jsdom
// LiveRegion.interrupt: cut off a screen reader still reading a long polite
// line by changing the assertive region silently. Measured on VoiceOver +
// Safari: only an assertive-region change stops it. Chromium drops changes made
// only of whitespace or format characters, so the cut uses U+034F combining
// grapheme joiners (two, then three, alternating because Chromium ignores a
// write of the same text). A single invisible character is read by name.
import { beforeEach, describe, expect, it } from "vitest";
import { ChoiceMenu } from "../src/ui/choice-menu.js";
import { LiveRegion } from "../src/ui/live-region.js";
import { Narrator } from "../src/ui/narrator.js";
import { speakHint } from "../src/ui/hint-speech.js";

const LONG = "A long line that is still being read aloud by the reader.";
const CGJ2 = "\u034f\u034f";
const CGJ3 = "\u034f\u034f\u034f";

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

  it("writes two combining grapheme joiners when a long line was announced just now", () => {
    live.announce("Pick a reply, 4 options. ".repeat(10));
    time += 100;
    expect(live.interrupt()).toBe(true);
    expect(assertive.textContent).toBe(CGJ2);
    expect(assertive.textContent).not.toContain("Picked");
    // The polite region and the last line are untouched.
    expect(polite.textContent).toContain("Pick a reply");
    expect(live.lastLine()).toContain("Pick a reply");
  });

  it("alternates two and three joiners so consecutive cuts always change the content", () => {
    live.announce(LONG);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(live.interrupt()).toBe(true);
      seen.push(assertive.textContent!);
    }
    expect(seen).toEqual([CGJ2, CGJ3, CGJ2, CGJ3]);
    for (const s of seen) {
      expect(s).toMatch(/^\u034f+$/);
      expect(s).not.toContain("\u2060");
    }
  });

  it("two consecutive interrupts write different text", () => {
    live.announce(LONG);
    expect(live.interrupt()).toBe(true);
    const first = assertive.textContent;
    expect(live.interrupt()).toBe(true);
    const second = assertive.textContent;
    expect(second).not.toBe(first);
    expect(first!.length).not.toBe(second!.length);
  });

  it("never writes whitespace or zero-width characters, which Chromium drops", () => {
    live.announce(LONG);
    for (let i = 0; i < 4; i++) {
      live.interrupt();
      expect(assertive.textContent).not.toMatch(/[\s\u00a0\u200b\u2060]/);
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
    expect(assertive.textContent).toBe(CGJ2);
    // The voiced line stayed out of the polite region.
    expect(polite.textContent).toBe(LONG);
  });
});

describe("speakHint cuts the screen reader (H)", () => {
  const mk = (opts: { willPlay: boolean; readVoiced?: boolean; reject?: boolean; noAudio?: boolean }) => {
    document.body.innerHTML = `<div id="log" role="log"></div><div id="int" aria-live="assertive"></div>`;
    const polite = document.getElementById("log")!;
    const assertive = document.getElementById("int")!;
    const live = new LiveRegion(polite, undefined, undefined, assertive, () => 1000);
    live.announce(LONG);
    const order: string[] = [];
    const ri = live.interrupt.bind(live);
    live.interrupt = (w?: string) => {
      order.push("cut");
      return ri(w);
    };
    const ra = live.announce.bind(live);
    live.announce = (t: string) => {
      order.push("announce");
      ra(t);
    };
    const audio = opts.noAudio
      ? undefined
      : {
          willPlay: () => opts.willPlay,
          play: () => {
            order.push("play");
            return opts.reject ? Promise.reject(new Error("x")) : Promise.resolve();
          },
        };
    const deps = {
      live,
      audio,
      readVoicedLines: opts.readVoiced ?? false,
      noHintText: "Nothing to hint at.",
      recordStatus: () => {},
      logVoiced: () => {},
    };
    return { live, assertive, order, deps };
  };
  const hint = { kind: "hint", milestoneId: "m", tier: "nudge", text: "Try the drawer.", audioKey: "k" } as const;

  it("voiced hint: cuts before the voice starts, text stays out of the polite region", () => {
    const t = mk({ willPlay: true });
    speakHint(hint, t.deps);
    expect(t.order).toEqual(["cut", "play"]);
    expect(t.assertive.textContent).toBe(CGJ2);
    expect(t.live.lastLine()).toBe("Try the drawer.");
  });

  it("text hint (ghost voice off or no file): cuts, then announces", () => {
    const t = mk({ willPlay: false });
    speakHint(hint, t.deps);
    expect(t.order).toEqual(["cut", "announce", "play"]);
  });

  it("text hint with no audio at all: cuts, then announces", () => {
    const t = mk({ willPlay: false, noAudio: true });
    speakHint(hint, t.deps);
    expect(t.order).toEqual(["cut", "announce"]);
  });

  it("D on (voiced lines read): cuts, announces, then plays", () => {
    const t = mk({ willPlay: true, readVoiced: true });
    speakHint(hint, t.deps);
    expect(t.order).toEqual(["cut", "announce", "play"]);
  });

  it("nothing to hint at: no cut, announced as before", () => {
    const t = mk({ willPlay: true });
    speakHint({ kind: "none" }, t.deps);
    expect(t.order).toEqual(["announce"]);
    expect(t.assertive.textContent).toBe("");
  });

  it("R repeats the hint after a voiced hint", () => {
    const t = mk({ willPlay: true });
    speakHint(hint, t.deps);
    t.live.repeat();
    expect(document.getElementById("log")!.textContent).toBe("Try the drawer.");
  });
});
