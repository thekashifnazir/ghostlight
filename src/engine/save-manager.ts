// Save / load / autosave manager (save-progress Requirements 2, 4).
//
// This is the self-contained behaviour behind the save key, the load key and
// the room-change autosave. It is wired into main.ts/controller.ts in the
// feature's final task, but owns all the logic here so it can be unit-tested
// without the page: every page dependency is injected (send a command, commit
// the store, announce a line, look up a room name, reload the page, set/clear a
// timer). The manager never reads the game canvas or the engine internals; it
// drives the engine only through the injected `send` (the adapter seam) and
// observes results through `onSaved` and the room events the page forwards.
//
// Key facts it is built around:
//   - The engine does NOT emit an error when a save fails; it only warns to its
//     own log (a11y.cpp dispatchSave). So a save that never completes is
//     detected by a page-side watchdog: arm a timer on send, cancel it on the
//     matching A11Y_SAVED. A fired timer means the save failed (R4.1).
//   - The engine loads only at launch (--save-slot). So load = record the slot
//     to continue from and reload the page; the continue path boots that slot
//     (R5.1). A boot that never reaches a room is the load-failure signal,
//     handled by the continue path, not here.

import type { Command } from "./adapter.js";
import type { Persistence, SaveKind } from "./persistence.js";
import { chapterOfSlot, chapterSlot, slotForSave } from "./persistence.js";

/** Wording decided in review (save-progress design, open question 4). */
export const SAVED_LINE = "Saved.";
export const SAVE_UNAVAILABLE_LINE =
  "Progress can't be saved in this browser, so it'll be lost when you close the page.";
export const SAVE_FAILED_LINE = "Progress can't be saved right now.";
export const LOAD_FAILED_LINE = "That saved game couldn't be loaded.";
/** Spoken as the quit key's save lands, just before the start screen loads. */
export const QUIT_LINE = "Saved. Back to the start screen.";

/** How long to wait for an A11Y_SAVED before declaring a save failed (ms). */
export const SAVE_WATCHDOG_MS = 4000;

/**
 * True when an A11Y_ERR message is the engine's own save rejection. The engine
 * (a11y.cpp dispatchSave) answers a bad `save` with a message that begins
 * "save " — "save needs a slot number…", "save slot must be a number…", "save
 * slot must be 1 or greater…". Matched on that prefix so only save errors are
 * ever classified as an autosave's error; an ordinary game error never begins
 * with "save ".
 */
export function isSaveError(message: string): boolean {
  return /^save\b/i.test(message.trim());
}

/** A cancellable timer, injected so tests drive it without real time. */
export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SaveManagerDeps {
  /** Send a command to the engine (the adapter seam). */
  send: (cmd: Command) => void;
  /** The persistent save store. */
  persistence: Pick<
    Persistence,
    "isAvailable" | "commit" | "latestSlot"
  >;
  /** Announce one functional line in the live region. */
  announce: (text: string) => void;
  /** Resolve a room number to its pack name, for "Loaded: <room>". */
  roomName: (room: number) => string | undefined;
  /**
   * Record "continue from slot N" and reload the page so the continue path
   * boots that slot. Injected so a test can assert the intent and reload
   * without navigating. The real wiring stores the slot (e.g. sessionStorage)
   * and calls location.reload().
   */
  requestReloadInto: (slot: number) => void;
  /**
   * Go back to the start screen (the quit key), after QUIT_LINE is announced.
   * Optional so tests that predate quitting need not wire it.
   */
  reloadToStart?: () => void;
  /** Cancellable timer for the save watchdog; defaults to window timers. */
  timer?: Timer;
  /** Watchdog window; defaults to SAVE_WATCHDOG_MS. */
  watchdogMs?: number;
}

const defaultTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class SaveManager {
  private readonly d: SaveManagerDeps;
  private readonly timer: Timer;
  private readonly watchdogMs: number;
  /** The watchdog handle for an in-flight manual save, or undefined. */
  private pendingManual: unknown;
  /**
   * Whether the first room event has been seen. The autosave is gated until
   * after it, so a continue-boot's first room does not immediately overwrite
   * the autosave the player just loaded from (design, autosave guard).
   */
  private firstRoomSeen = false;
  /**
   * Whether a room-change autosave is in flight (sent, no A11Y_SAVED yet). Used
   * only to classify an engine save error as belonging to an autosave, so that
   * error is swallowed (logged, never spoken) while a manual save's error still
   * speaks — see handleError.
   */
  private pendingAuto = false;
  /**
   * A chapter save waiting for the room-change autosave to finish (the engine
   * takes one command at a time), or in flight. Quiet, like an autosave.
   */
  private pendingChapter: number | undefined;
  private chapterInFlight = false;
  /** Set by quit(): once the manual save lands, go back to the start screen. */
  private quitting = false;

  constructor(deps: SaveManagerDeps) {
    this.d = deps;
    this.timer = deps.timer ?? defaultTimer;
    this.watchdogMs = deps.watchdogMs ?? SAVE_WATCHDOG_MS;
  }

  /**
   * The save key (C). Save to the manual slot and arm the watchdog. When the
   * store is unavailable, the engine save is inert for persistence, so instead
   * of promising "Saved." the manager states the honest in-browser reality
   * (R4.4); it does not send a command that cannot be made to last.
   */
  save(): void {
    if (!this.d.persistence.isAvailable()) {
      this.d.announce(SAVE_UNAVAILABLE_LINE);
      return;
    }
    // Replace any earlier pending watchdog (a rapid second press supersedes).
    this.clearPending();
    this.pendingManual = this.timer.set(() => {
      this.pendingManual = undefined;
      this.quitting = false;
      this.d.announce(SAVE_FAILED_LINE);
    }, this.watchdogMs);
    this.d.send({ verb: "save", slot: slotForSave("manual") });
  }

  /**
   * Called when the page sees an A11Y_SAVED event. `slot` is the saved slot.
   * A manual save (slot !== autosave) cancels the watchdog, commits the store,
   * and announces "Saved." (or the failure line if the commit does not stick).
   * An autosave commits quietly, with no spoken line, so it never clobbers the
   * room announcement (R2.5, screen-reader-output: one update per action).
   */
  async onSaved(slot: number): Promise<void> {
    const autoSlot = slotForSave("auto");
    if (slot === autoSlot) {
      this.pendingAuto = false;
      await this.d.persistence.commit();
      this.sendPendingChapter();
      return;
    }
    if (chapterOfSlot(slot) !== undefined) {
      this.chapterInFlight = false;
      await this.d.persistence.commit();
      return;
    }
    // Manual save: resolve the watchdog and report the outcome.
    this.clearPending();
    const ok = await this.d.persistence.commit();
    if (ok && this.quitting) {
      this.quitting = false;
      this.d.announce(QUIT_LINE);
      this.d.reloadToStart?.();
      return;
    }
    this.quitting = false;
    this.d.announce(ok ? SAVED_LINE : SAVE_FAILED_LINE);
  }

  /**
   * Called when the player reaches a new chapter (2 and up). Saves the start of
   * the chapter into its own slot, quietly, so the start screen can offer it
   * later. Sent after the room-change autosave lands, since the engine takes
   * one command at a time.
   */
  onChapterStart(chapter: number): void {
    if (chapter < 2 || !this.d.persistence.isAvailable()) return;
    this.pendingChapter = chapterSlot(chapter);
    if (!this.pendingAuto) this.sendPendingChapter();
  }

  /**
   * The quit key's second press: save to the manual slot (so Continue resumes
   * right here), then go back to the start screen. If saving isn't possible,
   * say so and stay in the game.
   */
  quit(): void {
    if (!this.d.persistence.isAvailable()) {
      this.d.announce(SAVE_UNAVAILABLE_LINE);
      return;
    }
    this.quitting = true;
    this.save();
  }

  private sendPendingChapter(): void {
    if (this.pendingChapter === undefined) return;
    const slot = this.pendingChapter;
    this.pendingChapter = undefined;
    this.chapterInFlight = true;
    this.d.send({ verb: "save", slot });
  }

  /**
   * Called on every room the page enters. The first room is not autosaved (it
   * may be a freshly loaded slot), and later room changes autosave into the
   * reserved slot (R2.5). Does nothing when persistence is unavailable.
   */
  onRoomChange(): void {
    if (!this.firstRoomSeen) {
      this.firstRoomSeen = true;
      return;
    }
    if (!this.d.persistence.isAvailable()) return;
    this.pendingAuto = true;
    this.d.send({ verb: "save", slot: slotForSave("auto") });
  }

  /**
   * Classify an engine A11Y_ERR and decide whether the page may announce it.
   * Returns true when the manager has consumed the error (the caller must stay
   * silent), false when the error is not ours and the page should announce it
   * as usual.
   *
   * A save error (the engine's `save …` rejections from a11y.cpp dispatchSave)
   * that arrives while a room-change autosave is in flight belongs to that
   * autosave. An autosave is silent by design — it must never clobber the room
   * line with a spoken error (R2.5, screen-reader-output: one update per
   * action) — so such an error is logged for developers and swallowed, and the
   * in-flight autosave is cleared. A save error with no autosave pending is a
   * manual save's failure, which still speaks through the manual watchdog /
   * onSaved path, so it is left for the page to surface. Any non-save error
   * (an ordinary game rejection like "no handler for command: fly") is never
   * ours and is returned for announcement.
   */
  handleError(message: string): boolean {
    if ((this.pendingAuto || this.chapterInFlight) && isSaveError(message)) {
      this.pendingAuto = false;
      this.chapterInFlight = false;
      // Log only; never spoken. Keeps the room line intact at a room change.
      console.warn(`[ghostlight] autosave error (not announced): ${message}`);
      return true;
    }
    return false;
  }

  /**
   * The load key (O). Resolve the most recent slot and request a reload into
   * it (the engine loads only at launch, so a load is a relaunch). When no
   * save exists, say so rather than reloading into nothing (R4.2).
   */
  load(): void {
    const slot = this.d.persistence.latestSlot();
    if (slot === undefined) {
      this.d.announce(LOAD_FAILED_LINE);
      return;
    }
    this.d.requestReloadInto(slot);
  }

  /**
   * Announce "Loaded: <room>" once the loaded room state arrives after a
   * continue/load boot. Called by the page's continue path when it booted into
   * a slot and the first room is read. Falls back to a bare "Loaded." when the
   * pack has no name for the room (R2.4).
   */
  announceLoaded(room: number, nudge?: string): void {
    const name = this.d.roomName(room);
    const line = name ? `Loaded: ${name}.` : "Loaded.";
    this.d.announce(nudge ? `${line} ${nudge}` : name ? `Loaded: ${name}` : line);
  }

  /** Announce a failed load (a continue boot that never reached a room). */
  announceLoadFailed(): void {
    this.d.announce(LOAD_FAILED_LINE);
  }

  private clearPending(): void {
    if (this.pendingManual !== undefined) {
      this.timer.clear(this.pendingManual);
      this.pendingManual = undefined;
    }
  }
}

export type { SaveKind };
