// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_AFTER_LOAD_MS, MAX_REFOCUS, holdFocusThroughLoad } from "../src/ui/hold-focus.js";

function buttons(): [HTMLButtonElement, HTMLButtonElement] {
  document.body.innerHTML = '<button id="start">Start</button><button id="other">How to play</button>';
  return [document.getElementById("start") as HTMLButtonElement, document.getElementById("other") as HTMLButtonElement];
}

describe("holdFocusThroughLoad (Safari + VoiceOver focus on load)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("focuses the button and puts focus back when it falls to the body", () => {
    const [start] = buttons();
    holdFocusThroughLoad(start);
    expect(document.activeElement).toBe(start);
    start.blur(); // what VoiceOver's page read does
    expect(document.activeElement).toBe(document.body);
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(start);
  });

  it("leaves a move to another element alone", () => {
    const [start, other] = buttons();
    holdFocusThroughLoad(start);
    other.focus();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(other);
  });

  it("stops holding after the load window", () => {
    const [start] = buttons();
    holdFocusThroughLoad(start);
    vi.advanceTimersByTime(HOLD_AFTER_LOAD_MS + 1);
    start.blur();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("puts focus back at most MAX_REFOCUS times", () => {
    const [start] = buttons();
    holdFocusThroughLoad(start);
    for (let i = 0; i < MAX_REFOCUS; i++) {
      start.blur();
      vi.advanceTimersByTime(0);
      expect(document.activeElement).toBe(start);
    }
    start.blur();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("does nothing once the button has left the page (the game started)", () => {
    const [start] = buttons();
    holdFocusThroughLoad(start);
    start.remove();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("can be stopped early", () => {
    const [start] = buttons();
    const stop = holdFocusThroughLoad(start);
    stop();
    start.blur();
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(document.body);
  });
});
