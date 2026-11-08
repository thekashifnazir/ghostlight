// A deterministic readiness signal for tests and screen-reader harnesses.
//
// The problem this solves: a test or an NVDA harness that drives the player by
// keyboard has no reliable way to know when the engine has finished responding
// to the last command, so it falls back to fixed sleeps (`waitForTimeout`).
// Fixed sleeps are either too short (flaky) or too long (slow), and they can
// never tell "the engine is still talking" apart from "the engine is wedged".
//
// `window.__ghostlight` is a tiny, read-only status object the player keeps up
// to date as it boots, routes engine events, and sends commands. A harness
// waits on real state — "phase is 'ready'", "phase left 'conversation'" — via
// `window.__ghostlight.waitFor(phase, timeoutMs)`, instead of guessing a
// duration. The current phase is also mirrored on
// `document.documentElement.dataset.glPhase`, so a Playwright test can
// `expect(locator).toHaveAttribute('data-gl-phase', 'ready')` with the built-in
// auto-waiting, and a CDP/bridge harness can read one attribute.
//
// It is for observers only: nothing in the player reads it back, it never
// writes to the live region, binds no keys, and renders no UI, so it cannot
// change what a player hears or does. When no `window`/`document` exists (unit
// tests, SSR), the global and the dataset mirror are simply skipped and the
// object still works as a plain state machine the tests drive directly.
//
// Phases
// ------
//   gate          the start gate is up; the engine has not booted
//   booting        a fresh start is booting the engine toward the first room
//   loading        a save-slot boot (Continue / load) is restoring a saved game
//   ready          the engine has settled after the last command; keys accepted
//   busy           a sent command has not settled yet (see the quiet period)
//   conversation   dialogue lines are still arriving (after a `talk`)
//   choice         a choice menu is open and waiting for the player
//   cutscene        a skippable scene is playing (e.g. the chapter 1->2 crossing)
//   error          the engine reported an error on the last command
//
// Settling (reused transport-settle quiet-period logic)
// -----------------------------------------------------
// A command does not settle on a single marker; like the native transport
// (`mcp/src/native.ts`, the transport-settle bugfix), it settles on a QUIET
// PERIOD. Sending a command moves the phase to `busy` and arms an inactivity
// timer; every engine line (`recordLine`) and every typed event (`onEvent`)
// bumps it. When no engine output has arrived for `settleQuietMs`, the command
// is deemed settled and the phase returns to `ready` — unless a `choices`
// event has meanwhile opened a `choice` menu, dialogue is still arriving
// (`conversation`), or a cutscene is playing, which are their own waited-on
// phases. This mirrors the transport's "reset on every A11Y line" rule, so a
// slow-but-progressing command (a multi-second conversation reply, a paced
// cutscene) is never prematurely marked ready.

import type { EngineEvent } from "./adapter.js";

/** The player's readiness phases. See the file header for what each means. */
export type Phase =
  | "gate"
  | "booting"
  | "ready"
  | "busy"
  | "conversation"
  | "choice"
  | "cutscene"
  | "loading"
  | "error";

/** One recorded live-region line. */
export interface StatusLine {
  /** Monotonic sequence number; equal to `lineSeq` at the time it was recorded. */
  seq: number;
  /** Milliseconds since the status object was created (boot). */
  t: number;
  /** The functional text that reached the live region. */
  text: string;
}

/** The read-only shape exposed on `window.__ghostlight`. */
export interface GhostlightStatus {
  /** The current readiness phase. */
  readonly phase: Phase;
  /** The engine room number, or 0 before the first room. */
  readonly room: number;
  /** The engine chapter number. */
  readonly chapter: number;
  /** Increments on every live-region line recorded. */
  readonly lineSeq: number;
  /** The most recent live-region line's text, or "" before any. */
  readonly lastLine: string;
  /** The last 200 live-region lines, oldest first. */
  readonly lines: readonly StatusLine[];
  /**
   * Resolve when the phase becomes `phase` (resolving immediately if it already
   * is), rejecting after `timeoutMs`. For waiting until a phase LEAVES, pass a
   * predicate to `waitWhile` instead.
   */
  waitFor(phase: Phase, timeoutMs?: number): Promise<void>;
  /**
   * Resolve when `predicate(phase)` first returns false (resolving immediately
   * if it already is false), rejecting after `timeoutMs`. Used to wait until a
   * phase is left, e.g. `waitWhile(p => p === 'conversation')`.
   */
  waitWhile(predicate: (phase: Phase) => boolean, timeoutMs?: number): Promise<void>;
}

/** How many recent lines the ring buffer keeps. */
const LINES_KEPT = 200;

/** Default quiet period before a `busy` command is deemed settled (ms). */
const DEFAULT_SETTLE_QUIET_MS = 400;

/** Default timeout for `waitFor`/`waitWhile` (ms). */
const DEFAULT_WAIT_TIMEOUT_MS = 90_000;

/** Options for the status tracker (mostly for tests to shorten timers). */
export interface StatusOptions {
  /**
   * The quiet period, in ms, with no engine output after which a `busy`
   * command is deemed settled and the phase returns to `ready`. Defaults to
   * {@link DEFAULT_SETTLE_QUIET_MS}. A test can pass a small value to settle
   * fast; a `setTimeout` injection lets a unit test drive it synchronously.
   */
  settleQuietMs?: number;
  /** Clock + timer injection, so a unit test can settle without real time. */
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** One pending `waitFor`/`waitWhile` waiter. */
interface Waiter {
  satisfied: (phase: Phase) => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: unknown;
}

/**
 * The readiness tracker. The player owns one instance, drives it with
 * `onStart`/`onEvent`/`onSend`/`recordLine`, and publishes it on
 * `window.__ghostlight`. It is deliberately independent of the DOM and the
 * adapters so a unit test can construct it and feed it synthetic events.
 */
export class StatusTracker {
  private _phase: Phase = "gate";
  private _room = 0;
  private _chapter = 1;
  private _lineSeq = 0;
  private _lastLine = "";
  private readonly _lines: StatusLine[] = [];

  private readonly bornAt: number;
  private readonly settleQuietMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  /** The in-flight settle timer for the current `busy` command, if any. */
  private settleTimer: unknown;
  private readonly waiters = new Set<Waiter>();

  /** The frozen read-only view published on `window.__ghostlight`. */
  readonly status: GhostlightStatus;

  constructor(options: StatusOptions = {}) {
    this.settleQuietMs = options.settleQuietMs ?? DEFAULT_SETTLE_QUIET_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimeout ??
      ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimer =
      options.clearTimeout ?? ((handle) => clearTimeout(handle as never));
    this.bornAt = this.now();

    // The published object reads straight through to the live fields via
    // getters, so observers always see current state, and exposes only the
    // read methods — never a setter — so a harness cannot drive the player by
    // writing to it.
    const self = this;
    this.status = {
      get phase() {
        return self._phase;
      },
      get room() {
        return self._room;
      },
      get chapter() {
        return self._chapter;
      },
      get lineSeq() {
        return self._lineSeq;
      },
      get lastLine() {
        return self._lastLine;
      },
      get lines() {
        // A shallow copy so an observer cannot mutate the ring buffer.
        return self._lines.slice();
      },
      waitFor: (phase, timeoutMs) => self.waitFor(phase, timeoutMs),
      waitWhile: (predicate, timeoutMs) => self.waitWhile(predicate, timeoutMs),
    };
  }

  /** The current phase (for the player's own wiring and unit tests). */
  get phase(): Phase {
    return this._phase;
  }

  /**
   * Publish the status on `window.__ghostlight` and start mirroring the phase
   * on `document.documentElement.dataset.glPhase`. A no-op where there is no
   * window/document (unit tests), so the tracker still works headless.
   */
  publish(): void {
    if (typeof window !== "undefined") {
      (window as unknown as { __ghostlight?: GhostlightStatus }).__ghostlight =
        this.status;
    }
    this.mirrorPhase();
  }

  // --- transitions the player drives ---------------------------------------

  /**
   * The start gate was dismissed and the engine is booting. `intoSlot` is true
   * for a Continue / load boot (phase `loading`), false for a fresh start
   * (phase `booting`). The first `room` event moves it to `ready`.
   */
  onStart(intoSlot: boolean): void {
    this.setPhase(intoSlot ? "loading" : "booting");
  }

  /**
   * A command was sent to the engine. Moves to `busy` and arms the quiet-period
   * settle timer, unless the player is already in a waited-on phase that the
   * engine's own events (not a quiet period) resolve: a `choice` menu (resolved
   * by the player choosing, which sends `choose` and is itself a command), or a
   * `cutscene` (resolved by the crossing skip's diff). `isCutsceneTrigger` is
   * set by the scripted-exit crossing walk, which starts a `cutscene` phase
   * that the subsequent chapter-change diff ends.
   */
  onSend(isCutsceneTrigger = false): void {
    if (isCutsceneTrigger) {
      this.setPhase("cutscene");
      this.armSettle();
      return;
    }
    this.setPhase("busy");
    this.armSettle();
  }

  /**
   * Route one typed engine event. This is the authoritative phase driver: a
   * `room` settles to `ready`, a `choices` opens a `choice` menu, a `diff`
   * settles (ending any conversation/cutscene), an `error` moves to `error`,
   * and a `text` line during a command marks `conversation` (dialogue still
   * arriving). Every event bumps the quiet-period timer.
   */
  onEvent(e: EngineEvent): void {
    this.bumpSettle();
    switch (e.type) {
      case "room":
        this._room = e.state.room;
        this._chapter = e.state.chapter;
        this.cancelSettle();
        this.setPhase("ready");
        break;
      case "diff":
        if (e.diff.room) this._room = e.diff.room[1];
        if (e.diff.chapter) this._chapter = e.diff.chapter[1];
        // A diff is the engine's settled response: it ends a conversation, a
        // cutscene, or a plain busy command. Settle to ready at once.
        this.cancelSettle();
        this.setPhase("ready");
        break;
      case "choices":
        // A choice menu is open and waiting for the player; not a quiet-period
        // settle — it is resolved by the player choosing.
        this.cancelSettle();
        this.setPhase("choice");
        break;
      case "text":
        // Dialogue (or any drawn line) is still arriving: a conversation is in
        // progress. Keep bumping the quiet period so the conversation is not
        // mistaken for a settled command; the diff (or choices) that follows
        // moves it on.
        if (this._phase === "busy" || this._phase === "conversation") {
          this.setPhase("conversation");
        }
        break;
      case "error":
        this.cancelSettle();
        this.setPhase("error");
        break;
      case "inv":
      case "cmd":
      case "saved":
        // Not phase-changing on their own; the bump above keeps the quiet
        // period alive so the following diff settles the command.
        break;
    }
  }

  /**
   * Record one functional line that reached the live region: bump the sequence,
   * remember it as `lastLine`, and push it onto the capped ring buffer. Also
   * bumps the settle quiet period, so a command that is still narrating is not
   * prematurely marked ready. Never writes to the live region itself.
   */
  recordLine(text: string): void {
    const line = text.trim();
    if (!line) return;
    this._lineSeq += 1;
    this._lastLine = line;
    this._lines.push({ seq: this._lineSeq, t: this.now() - this.bornAt, text: line });
    if (this._lines.length > LINES_KEPT) this._lines.shift();
    this.bumpSettle();
  }

  // --- waiting --------------------------------------------------------------

  waitFor(phase: Phase, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<void> {
    return this.waitUntil((p) => p === phase, timeoutMs, `phase "${phase}"`);
  }

  waitWhile(
    predicate: (phase: Phase) => boolean,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<void> {
    return this.waitUntil(
      (p) => !predicate(p),
      timeoutMs,
      "the phase to change",
    );
  }

  private waitUntil(
    satisfied: (phase: Phase) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    if (satisfied(this._phase)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        satisfied,
        resolve,
        reject,
        timer: this.setTimer(() => {
          this.waiters.delete(waiter);
          reject(
            new Error(
              `__ghostlight.waitFor timed out after ${timeoutMs}ms waiting for ` +
                `${label}; phase is "${this._phase}".`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  // --- internals ------------------------------------------------------------

  private setPhase(phase: Phase): void {
    if (this._phase === phase) {
      // Even with no change, satisfy any waiter already matching (e.g. a
      // waitFor registered after the phase was set). Nothing to mirror.
      this.resolveWaiters();
      return;
    }
    this._phase = phase;
    this.mirrorPhase();
    this.resolveWaiters();
  }

  private mirrorPhase(): void {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.dataset.glPhase = this._phase;
    }
  }

  private resolveWaiters(): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.satisfied(this._phase)) {
        this.clearTimer(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve();
      }
    }
  }

  /** Arm (or re-arm) the quiet-period settle timer for the current command. */
  private armSettle(): void {
    this.cancelSettle();
    this.settleTimer = this.setTimer(() => {
      this.settleTimer = undefined;
      // Only a busy/conversation/cutscene command settles on quiet; a choice
      // menu and the gate/ready/error phases are not quiet-period driven.
      if (
        this._phase === "busy" ||
        this._phase === "conversation" ||
        this._phase === "cutscene"
      ) {
        this.setPhase("ready");
      }
    }, this.settleQuietMs);
  }

  /** Reset the quiet period on any engine output, while a command is in flight. */
  private bumpSettle(): void {
    if (this.settleTimer !== undefined) this.armSettle();
  }

  /** Cancel the settle timer (a definitive event settled the command). */
  private cancelSettle(): void {
    if (this.settleTimer !== undefined) {
      this.clearTimer(this.settleTimer);
      this.settleTimer = undefined;
    }
  }
}
