// Chapter-crossing cutscene skip scheduler.
//
// The problem. Walking through the curtained doorway at the end of chapter 1
// (the scripted exit the pack marks `to: null`, engine exit 105) makes the live
// engine run its bedtime cutscene (`animation_2_1`), which BLOCKS the engine's
// main loop and only advances when a single `skip` is written to the command
// file WHILE the cutscene is running. Nothing in the web player sends that skip
// on its own, so the player would sit through the whole cutscene and never
// reach chapter 2 — hence the player schedules one.
//
// The old scheme sent that `skip` at a FIXED 400 ms delay after the walk. That
// landed inside the cutscene's event loop so early that it skipped the scene
// from the very start, so the cutscene's dialogue — 'BY THE WAY, BE CAREFUL
// BECAUSE I JUST WAXED THE FLOOR', 'ARE YOU ALL RIGHT? HEY, COME ON, WAKE
// UP!...', 'THERE IS NO PLACE LIKE HOME' — was never announced. A live
// line-log check caught the regression: the player jumped straight to
// 'Chapter 2: The village.'.
//
// The fix this class implements. After a crossing walk, do NOT skip at a fixed
// delay. Instead WAIT for the cutscene's own lines to finish arriving — a quiet
// period with no new announced line for `quietMs` (~4 s), measured from the
// LAST line — and only then, if the chapter has not already advanced, send
// exactly ONE skip to clear the final blocked frame. If engine truth says the
// engine is back in control (phase `control`) or the chapter changes first, the
// cutscene has already ended on its own and NOTHING is sent. Exactly one skip
// ever: over-skipping corrupts the hero mid-animation (engine process log), so
// once the skip is sent (or the crossing settles / is cancelled) the scheduler
// disarms and ignores everything until the next crossing walk.
//
// It is deliberately DOM-free and clock-injectable so a unit test can drive it
// with fake timers: lines keep arriving -> no skip; 4 s of quiet -> one skip;
// chapter changed (or phase control) first -> none.

/** The engine's own control phase, as reported by `A11Y_PHASE`. */
import type { EnginePhase } from "./adapter.js";

/** How long with no new announced line before the one skip is sent (ms). */
export const CROSSING_QUIET_MS = 4000;

/** Timer/clock injection, so a unit test can settle without real time. */
export interface CrossingSkipOptions {
  /** The quiet period, in ms, before the one skip fires. Defaults to {@link CROSSING_QUIET_MS}. */
  quietMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Schedules the single paced `skip` that advances the chapter 1 -> 2 crossing
 * cutscene, driven by the lines, phases and chapter changes the player already
 * observes. One instance is owned by the player; `arm` starts a crossing, and
 * `noteLine` / `notePhase` / `noteChapter` feed it the signals that decide when
 * (or whether) the skip is sent.
 */
export class CrossingSkip {
  private readonly quietMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly sendSkip: () => void;

  /** The quiet-period timer, non-undefined only while a crossing is armed. */
  private timer: unknown;
  /** The chapter at the moment the crossing walk was sent, while armed. */
  private chapterAtWalk: number | undefined;

  /**
   * @param sendSkip Called at most once per crossing to send the single `skip`.
   */
  constructor(sendSkip: () => void, options: CrossingSkipOptions = {}) {
    this.sendSkip = sendSkip;
    this.quietMs = options.quietMs ?? CROSSING_QUIET_MS;
    this.setTimer =
      options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      options.clearTimeout ?? ((handle) => clearTimeout(handle as never));
  }

  /** True while a crossing is armed and the one skip has not yet resolved. */
  get armed(): boolean {
    return this.chapterAtWalk !== undefined;
  }

  /**
   * A walk through a scripted crossing exit was just sent. Arm the scheduler:
   * remember the chapter at the walk and start the quiet-period timer. The
   * timer is (re)armed on every subsequent line, so the skip fires only once
   * the cutscene's lines have stopped arriving. Arming again while already
   * armed (a second crossing walk before the first resolved) restarts cleanly.
   */
  arm(chapterAtWalk: number): void {
    this.chapterAtWalk = chapterAtWalk;
    this.armQuiet();
  }

  /**
   * A functional line reached the live region. While armed, this is a
   * cutscene line still arriving, so push the quiet period out: the skip is
   * only sent once `quietMs` has passed since the LAST line.
   */
  noteLine(): void {
    if (this.armed) this.armQuiet();
  }

  /**
   * The engine reported its control phase. While armed, `control` means the
   * engine finished the cutscene and is ready on its own, so the crossing
   * settled without us: disarm and send nothing. `busy` / `choice` are the
   * cutscene still running and are ignored (the quiet period governs).
   */
  notePhase(phase: EnginePhase): void {
    if (this.armed && phase === "control") this.cancel();
  }

  /**
   * The engine reported the current chapter (from a room or diff). While
   * armed, a chapter different from the one at the walk means the crossing
   * advanced on its own: disarm and send nothing.
   */
  noteChapter(chapter: number): void {
    if (this.armed && chapter !== this.chapterAtWalk) this.cancel();
  }

  /** Disarm without sending (a definitive signal ended the crossing). */
  cancel(): void {
    this.clearQuiet();
    this.chapterAtWalk = undefined;
  }

  // --- internals ------------------------------------------------------------

  /** (Re)start the quiet-period timer from now. */
  private armQuiet(): void {
    this.clearQuiet();
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      // The cutscene's lines have stopped arriving and the chapter has not
      // advanced (noteChapter would have cancelled us): send exactly one skip
      // to clear the final blocked frame, then disarm so no second skip can
      // ever fire (the over-skip guard).
      const was = this.chapterAtWalk;
      this.chapterAtWalk = undefined;
      if (was !== undefined) this.sendSkip();
    }, this.quietMs);
  }

  private clearQuiet(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}
