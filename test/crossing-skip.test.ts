import { describe, expect, it } from "vitest";
import { CrossingSkip, CROSSING_QUIET_MS } from "../src/engine/crossing-skip.js";

// Unit tests for the chapter-crossing cutscene skip scheduler
// (src/engine/crossing-skip.ts). The regression these guard against: a fixed
// 400 ms skip after a crossing walk skipped the bedtime cutscene from the very
// start, so its dialogue was never announced. The scheduler instead waits for
// the cutscene's lines to go quiet (CROSSING_QUIET_MS from the last line) and
// sends exactly ONE skip only if the chapter has not already advanced; engine
// `control` or a chapter change first means no skip at all.
//
// Time is injected through a manual clock + timer queue so the quiet period is
// deterministic and the tests never sleep.

/** A manual clock + timer queue (the same shape the status tests use). */
function clock() {
  let nowMs = 0;
  interface Pending {
    id: number;
    due: number;
    fn: () => void;
  }
  const pending = new Map<number, Pending>();
  let nextId = 1;
  return {
    setTimeout: (fn: () => void, ms: number): number => {
      const id = nextId++;
      pending.set(id, { id, due: nowMs + ms, fn });
      return id;
    },
    clearTimeout: (handle: unknown): void => {
      pending.delete(handle as number);
    },
    /** Advance virtual time by `ms`, firing any timers that come due. */
    advance: (ms: number): void => {
      nowMs += ms;
      for (const p of [...pending.values()].sort((a, b) => a.due - b.due)) {
        if (p.due <= nowMs && pending.has(p.id)) {
          pending.delete(p.id);
          p.fn();
        }
      }
    },
  };
}

/** A scheduler wired to the manual clock, counting the skips it sends. */
function makeScheduler(quietMs = CROSSING_QUIET_MS) {
  const c = clock();
  let skips = 0;
  const skip = new CrossingSkip(() => void skips++, {
    quietMs,
    setTimeout: c.setTimeout,
    clearTimeout: c.clearTimeout,
  });
  return { skip, advance: c.advance, skips: () => skips };
}

describe("CrossingSkip", () => {
  it("sends no skip while cutscene lines keep arriving", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    // A line lands every 1 s, inside the 4 s quiet window: the timer keeps
    // being pushed out, so no skip is ever sent across a long cutscene.
    for (let i = 0; i < 10; i++) {
      advance(1000);
      expect(skips()).toBe(0);
      skip.noteLine();
    }
    // Still armed, still nothing sent: the lines never went quiet.
    expect(skip.armed).toBe(true);
    expect(skips()).toBe(0);
  });

  it("sends exactly one skip after 4 s of quiet with the chapter unchanged", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    // The cutscene speaks three lines, each within the quiet window.
    skip.noteLine();
    advance(1500);
    skip.noteLine();
    advance(1500);
    skip.noteLine();
    // Not yet: only 3 s of quiet since the last line.
    advance(3000);
    expect(skips()).toBe(0);
    // The full quiet period elapses from the last line -> exactly one skip.
    advance(CROSSING_QUIET_MS - 3000);
    expect(skips()).toBe(1);
    expect(skip.armed).toBe(false);

    // Over-skip guard: no further line or time can produce a second skip.
    skip.noteLine();
    advance(CROSSING_QUIET_MS * 2);
    expect(skips()).toBe(1);
  });

  it("sends no skip when the chapter changes first", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    skip.noteLine();
    advance(1000);
    // The engine advances to chapter 2 on its own before the quiet period.
    skip.noteChapter(2);
    expect(skip.armed).toBe(false);
    // The quiet period passing now sends nothing (the crossing already moved).
    advance(CROSSING_QUIET_MS * 2);
    expect(skips()).toBe(0);
  });

  it("sends no skip when the engine reports control first", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    skip.noteLine();
    advance(1000);
    // Engine truth: the cutscene ended and the engine is back in control.
    skip.notePhase("control");
    expect(skip.armed).toBe(false);
    advance(CROSSING_QUIET_MS * 2);
    expect(skips()).toBe(0);
  });

  it("ignores busy and choice phases (the quiet period still governs)", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    skip.notePhase("busy");
    skip.noteLine();
    skip.notePhase("busy");
    expect(skip.armed).toBe(true);
    // No control / chapter change, so after the quiet period one skip fires.
    advance(CROSSING_QUIET_MS);
    expect(skips()).toBe(1);
  });

  it("ignores a chapter noted equal to the walk chapter", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    // A same-room diff during the cutscene still reports chapter 1.
    skip.noteChapter(1);
    expect(skip.armed).toBe(true);
    advance(CROSSING_QUIET_MS);
    expect(skips()).toBe(1);
  });

  it("does nothing when not armed", () => {
    const { skip, advance, skips } = makeScheduler();
    // Signals before any crossing walk are no-ops.
    skip.noteLine();
    skip.notePhase("control");
    skip.noteChapter(2);
    advance(CROSSING_QUIET_MS * 2);
    expect(skips()).toBe(0);
    expect(skip.armed).toBe(false);
  });

  it("re-arming restarts the quiet period cleanly", () => {
    const { skip, advance, skips } = makeScheduler();
    skip.arm(1);
    advance(3000);
    // A second crossing walk before the first settled re-arms from now.
    skip.arm(1);
    advance(3000);
    expect(skips()).toBe(0); // only 3 s since the re-arm
    advance(CROSSING_QUIET_MS - 3000);
    expect(skips()).toBe(1); // one skip, not two
  });
});
