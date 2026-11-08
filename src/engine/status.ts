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
// Settling: engine truth first, quiet-period fallback
// ----------------------------------------------------
// The engine a11y layer emits an `A11Y_PHASE` line straight from engine truth:
// `control` when the engine can take a command (`canSaveGameStateCurrently()`
// is true and nothing is running), `busy` while a command runs, and `choice`
// while a conversation menu is open. When these arrive (the live engine, and
// any recording made with the A11Y_PHASE-emitting build) they are AUTHORITATIVE:
// `control` -> `ready`, `busy` -> `busy` (or `conversation` while dialogue text
// is still arriving), `choice` -> `choice`. No pause between lines is used to
// guess that a conversation has ended; the engine says so.
//
// FALLBACK (old recordings with no A11Y_PHASE). A recording made before the
// engine emitted A11Y_PHASE carries none, so the tracker falls back to the
// earlier behaviour for that session only: a command moves to `busy` and arms
// a QUIET-PERIOD inactivity timer (like the native transport,
// `mcp/src/native.ts`); every engine line (`recordLine`) and typed event
// (`onEvent`) bumps it; after `settleQuietMs` with no output the command is
// deemed settled and returns to `ready` — unless a `choices` event opened a
// `choice` menu or dialogue is still arriving (`conversation`). The moment the
// first `A11Y_PHASE` of a session is seen, the tracker switches to engine truth
// and the quiet-period timer is no longer armed. This keeps the replay tests
// (whose fixtures predate A11Y_PHASE) passing unchanged.

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

  /**
   * True once the first `A11Y_PHASE` event of the session has been seen. From
   * then on the engine's own phase is authoritative and the quiet-period settle
   * timer is never armed (it is cancelled on the switch). An old recording with
   * no A11Y_PHASE leaves this false, so the quiet-period fallback drives the
   * phase for that session — which is what keeps the replay fixtures passing.
   */
  private engineTruth = false;

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
   * A command was sent to the engine. Moves to `busy` (or `cutscene` for a
   * scripted-exit crossing walk) for immediate feedback. In the fallback (no
   * A11Y_PHASE yet) it also arms the quiet-period settle timer; once engine
   * truth is established the engine's own `A11Y_PHASE control` returns it to
   * ready, so no timer is armed (a long command would otherwise settle early
   * before the next phase line arrives). `isCutsceneTrigger` is set by the
   * scripted-exit crossing walk, which starts a `cutscene` phase that the
   * subsequent chapter-change room/diff and `A11Y_PHASE control` end.
   */
  onSend(isCutsceneTrigger = false): void {
    this.setPhase(isCutsceneTrigger ? "cutscene" : "busy");
    if (!this.engineTruth) this.armSettle();
  }

  /**
   * Route one typed engine event. Under engine truth (any session that emits
   * `A11Y_PHASE`) the phase is driven by the `phase` events alone — `control`
   * -> `ready`, `busy` -> `busy`/`conversation`/`cutscene`, `choice` ->
   * `choice` — while `room`/`diff` only update the room/chapter. In the
   * fallback (old recordings with no phase lines) the earlier behaviour drives
   * it: a `room` and a `diff` settle to `ready`, a `choices` opens `choice`, a
   * `text` line during a command marks `conversation`, and a quiet period
   * settles a command that goes silent. A `text` line marks `conversation` and
   * an `error` moves to `error` in both modes. Every event bumps the fallback
   * quiet-period timer (a no-op once it is cancelled under engine truth).
   */
  onEvent(e: EngineEvent): void {
    this.bumpSettle();
    switch (e.type) {
      case "phase":
        // Engine truth. From the first phase line on, the engine's own control
        // state drives the readiness phase and the quiet-period timer is no
        // longer used (cancel any in flight).
        this.engineTruth = true;
        this.cancelSettle();
        switch (e.phase) {
          case "control":
            // The engine can take a command again: settled -> ready.
            this.setPhase("ready");
            break;
          case "busy":
            // A command is running. Map to 'busy' normally, but keep a
            // waited-on sub-phase the player set for this command — a
            // 'conversation' (dialogue still arriving) or a 'cutscene' (a
            // scripted-exit crossing in progress) — so a harness can wait it
            // out. The engine's next phase line (choice, or control at the end)
            // moves it on.
            if (this._phase !== "conversation" && this._phase !== "cutscene") {
              this.setPhase("busy");
            }
            break;
          case "choice":
            // A conversation choice menu is open and waiting for the player.
            this.setPhase("choice");
            break;
        }
        break;
      case "room":
        this._room = e.state.room;
        this._chapter = e.state.chapter;
        // A room event is unambiguously a settled state, so it resolves to
        // ready in both modes — under engine truth the engine's own
        // `A11Y_PHASE control` confirms it on the same idle frame.
        this.cancelSettle();
        this.setPhase("ready");
        break;
      case "diff":
        if (e.diff.room) this._room = e.diff.room[1];
        if (e.diff.chapter) this._chapter = e.diff.chapter[1];
        // Under engine truth the phase is driven by `A11Y_PHASE` alone: a diff
        // only carries room/chapter, and must NOT clobber a 'choice' menu that
        // a talk's diff is emitted alongside (the diff lands at choices-open).
        // In the fallback (no phase lines) a diff is the engine's settled
        // response and returns to ready at once.
        if (!this.engineTruth) {
          this.cancelSettle();
          this.setPhase("ready");
        }
        break;
      case "choices":
        // A choice menu is open and waiting for the player; not a quiet-period
        // settle — it is resolved by the player choosing. Under engine truth
        // the following `A11Y_PHASE choice` confirms it; setting it here too is
        // harmless (same phase) and keeps the fallback working.
        this.cancelSettle();
        this.setPhase("choice");
        break;
      case "text":
        // Dialogue (or any drawn line) is still arriving: a conversation is in
        // progress. In both modes a text line during a busy/conversation
        // command marks 'conversation'. Under engine truth the next
        // `A11Y_PHASE` (choice, or control at the end) moves it on; in the
        // fallback the bumped quiet period or the following diff/choices does.
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
        // period alive (fallback) so the following diff settles the command.
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
