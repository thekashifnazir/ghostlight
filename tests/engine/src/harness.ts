// The replay harness seam.
//
// Both tasks 21 and 22 drive the engine through this one interface. Today the
// only implementation is fixture-backed (FixtureHarness), replaying the lines
// recorded in spike 04. When the native build is wired (gotcha 12: a real
// window, fully headless SDL is flaky), a NativeHarness will implement the same
// interface by writing <savepath>/a11y-cmd.txt and reading back stderr. The
// tests never change; only the harness behind them does.

import type { A11yLine, Diff, RoomState } from "./lines.js";

/**
 * Drives the engine a11y layer by sending text commands and collecting the
 * a11y output lines each command produced.
 *
 * Contract shared by every implementation:
 * - start() brings the engine to its first playable room and returns the
 *   initial A11Y room-state line (Requirement 1.4).
 * - send(cmd) runs exactly one command, waits for it to settle, and returns the
 *   lines emitted while it ran, in order. The lines always include the A11Y_CMD
 *   echo and then either exactly one A11Y_DIFF or exactly one A11Y_ERR
 *   (Requirement 2.4, 2.5, 4.1), plus any A11Y_TEXT / A11Y_CHOICES / A11Y /
 *   A11Y_INV / A11Y_SAVED the command caused.
 */
export interface EngineHarness {
  /** Human-readable label, used in test names. */
  readonly label: string;
  /** Bring the engine to the first playable room; return its room state. */
  start(): Promise<RoomState>;
  /** Run one command; return the ordered lines it produced. */
  send(cmd: string): Promise<A11yLine[]>;
  /** Release any resources (a native process, a temp savepath). */
  stop(): Promise<void>;
}

/** The single diff in a command's output, or null if the command erred. */
export function diffOf(lines: A11yLine[]): Diff | null {
  const diffs = lines.filter((l): l is Diff => l.kind === "diff");
  return diffs.length === 1 ? diffs[0]! : null;
}

/** True when a command produced exactly one error line and no diff. */
export function erredOf(lines: A11yLine[]): boolean {
  const diffs = lines.filter((l) => l.kind === "diff").length;
  const errs = lines.filter((l) => l.kind === "err").length;
  return diffs === 0 && errs >= 1;
}

/** The room-state line a command produced, if any (room change or dump). */
export function roomStateOf(lines: A11yLine[]): RoomState | null {
  const rooms = lines.filter((l): l is RoomState => l.kind === "room");
  return rooms.length > 0 ? rooms[rooms.length - 1]! : null;
}
