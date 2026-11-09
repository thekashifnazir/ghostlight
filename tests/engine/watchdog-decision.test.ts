// Reply-menu drop regression: the busy watchdog must not escalate while a
// conversation (reply menu) is open.
//
// Bug (VoiceOver tester): opened the drunk's reply menu, browsed ~40 s, pressed
// Enter on option 3, and heard "The game didn't respond. Press L to hear where
// you are." The pick was lost. Root cause: while a conversation's reply menu is
// open the engine sits in converse.cpp's own modal loop, so poll() never runs
// and nothing is emitted — engine liveness (max of _lastPollMs and
// g_lastEngineOutputMs) goes stale while the player is legitimately thinking.
// When their `choose 3` was queued after 20-40 s, the watchdog saw "a command
// queued AND liveness stale" and escalated: stage 1 raised a skip, stage 2
// cleared the queue and emitted `A11Y_ERR busy: commands dropped`, dropping the
// pick.
//
// Fix (engine/a11y.cpp): the "should the watchdog act" decision is factored
// into the pure helper A11yLayer::watchdogDecision(). While converseActive is
// true it always returns kWatchdogNoop, so no escalation can ever happen with a
// reply menu open, no matter how long the player thinks or what is queued. This
// test ports that exact decision and locks the behaviour, since the fixture
// harness replays the native engine and cannot exercise the C++ decision
// without a rebuild.
//
// The port below is a line-for-line transliteration of watchdogDecision() in
// engine/a11y.cpp; keep the two in lockstep. kWatchdogMs mirrors the C++
// A11yLayer::kWatchdogMs (20 s).

import { describe, expect, it } from "vitest";

const kWatchdogMs = 20_000;

type WatchdogAction = "noop" | "hold" | "stage1" | "stage2";

/**
 * Pure transliteration of A11yLayer::watchdogDecision (engine/a11y.cpp).
 * Inputs are exactly what runBusyWatchdog() reads from engine state.
 */
function watchdogDecision(
  converseActive: boolean,
  queued: boolean,
  liveness: number,
  lastPollMs: number,
  now: number,
  stage: number,
  baseMs: number,
): WatchdogAction {
  // A conversation is open: the converse loop owns every queued command, and a
  // player browsing a reply menu looks exactly like a stale-liveness stall.
  if (converseActive) return "noop";

  // Nothing queued to settle: not a dead state.
  if (!queued) return "noop";

  // Nothing has run or been emitted yet (boot) — no stall to measure against.
  if (liveness === 0) return "hold";

  // Reset when the engine shows life again (stage-aware).
  if (stage === 0) {
    if (now - liveness < kWatchdogMs) return "noop";
  } else {
    if (lastPollMs > baseMs) return "noop";
  }

  // Liveness is stale AND commands are queued.
  if (stage === 0) return "stage1";

  // Already skipped (stage 1): wait a second full window from the anchor.
  if (stage === 1 && now - baseMs >= 2 * kWatchdogMs) return "stage2";

  // Stall building but no stage fires this frame.
  return "hold";
}

describe("busy watchdog decision: conversation reply menu is never a dead state", () => {
  it("does not escalate while a reply menu is open, even with a choose queued and stale liveness (the tester case)", () => {
    // The tester opened the reply menu, browsed ~40 s (> 2 * kWatchdogMs), then
    // their `choose 3` is queued. Liveness is stale because converse.cpp's loop
    // emitted nothing for the whole time. At every escalation stage the decision
    // must stay noop while converseActive is true.
    const openedAt = 1_000;
    const now = openedAt + 40_000; // 40 s of thinking
    for (const stage of [0, 1]) {
      const action = watchdogDecision(
        /* converseActive */ true,
        /* queued (choose 3) */ true,
        /* liveness (stale, from before the menu opened) */ openedAt,
        /* lastPollMs */ openedAt,
        now,
        stage,
        /* baseMs */ openedAt,
      );
      expect(action).toBe("noop");
    }
  });

  it("stays noop with a reply menu open no matter how stale liveness gets", () => {
    // Even an hour of thinking with commands queued must not escalate.
    const action = watchdogDecision(true, true, 1, 1, 3_600_000, 1, 1);
    expect(action).toBe("noop");
  });
});

describe("busy watchdog decision: outside a conversation is unchanged", () => {
  it("fresh liveness with a command queued is a no-op (engine alive)", () => {
    const now = 100_000;
    const action = watchdogDecision(false, true, now - 1_000, now - 1_000, now, 0, 0);
    expect(action).toBe("noop");
  });

  it("no command queued is a no-op", () => {
    const now = 100_000;
    const action = watchdogDecision(false, false, now - 60_000, 0, now, 0, 0);
    expect(action).toBe("noop");
  });

  it("stale liveness with a command queued escalates to stage 1", () => {
    const now = 100_000;
    // liveness older than kWatchdogMs, stage 0 → stage 1 (silent skip).
    const action = watchdogDecision(
      false,
      true,
      now - (kWatchdogMs + 1_000),
      now - (kWatchdogMs + 1_000),
      now,
      0,
      0,
    );
    expect(action).toBe("stage1");
  });

  it("still stuck one window after the stage-1 anchor drops the queue (stage 2)", () => {
    const base = 10_000;
    const now = base + 2 * kWatchdogMs + 1; // past the second window
    // Stage 1, poll() has not advanced past the anchor (lastPollMs == base).
    const action = watchdogDecision(false, true, base, base, now, 1, base);
    expect(action).toBe("stage2");
  });

  it("poll() resuming past the anchor resets the escalation (stage 1 → noop)", () => {
    const base = 10_000;
    const now = base + 2 * kWatchdogMs + 1;
    // lastPollMs advanced past baseMs → the main loop is live again.
    const action = watchdogDecision(false, true, base, base + 5_000, now, 1, base);
    expect(action).toBe("noop");
  });

  it("stage 1 before the second window has elapsed just holds", () => {
    const base = 10_000;
    const now = base + kWatchdogMs + 1_000; // past one window, not two
    const action = watchdogDecision(false, true, base, base, now, 1, base);
    expect(action).toBe("hold");
  });

  it("boot (no liveness yet) holds rather than escalating", () => {
    const action = watchdogDecision(false, true, 0, 0, 5_000, 0, 0);
    expect(action).toBe("hold");
  });
});
