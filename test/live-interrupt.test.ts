// @vitest-environment jsdom
// LiveRegion.interrupt: cut off a screen reader still reading a long polite
// line by writing a short word into the assertive region. Measured on
// VoiceOver + Safari: only an assertive-region change stops it.
import { beforeEach, describe, expect, it } from "vitest";
import { ChoiceMenu } from "../src/ui/choice-menu.js";
import { LiveRegion } from "../src/ui/live-region.js";

describe("LiveRegion.interrupt", () => {
  let polite: HTMLElement;
  let assertive: HTMLElement;
  let time: number;
  let live: LiveRegion;

  beforeEach(() => {
    document.body.innerHTML = `<div id="log" role="log" aria-live="polite"></div><div id="int" aria-live="assertive"></div>`;
    polite = document.getElementById("log")!;
    assertive = document.getElementById("int")!;
    time = 1000;
    live = new LiveRegion(polite, undefined, undefined, assertive, () => time);
  });

  it("writes Picked. when a long line was announced just now", () => {
    live.announce("Pick a reply, 4 options. ".repeat(10));
    time += 100;
    expect(live.interrupt()).toBe(true);
    expect(assertive.textContent).toBe("Picked.");
    // The polite region and the last line are untouched.
    expect(polite.textContent).toContain("Pick a reply");
    expect(live.lastLine()).toContain("Pick a reply");
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

  it("announces the same word twice via the repeat marker", () => {
    live.announce("A long line that is still being read aloud by the reader.");
    expect(live.interrupt()).toBe(true);
    const first = assertive.textContent;
    expect(live.interrupt()).toBe(true);
    const second = assertive.textContent;
    expect(second).not.toBe(first);
    expect(first!.replace(/\u2060/g, "")).toBe("Picked.");
    expect(second!.replace(/\u2060/g, "")).toBe("Picked.");
  });

  it("returns false when there is no assertive region", () => {
    const bare = new LiveRegion(polite, undefined, undefined, undefined, () => time);
    bare.announce("A long line that is still being read aloud by the reader.");
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
