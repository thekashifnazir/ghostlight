// The sonar controller (Requirements 2, 3, 4, 5).
//
// Holds the current room state and hotspot list, the step cursor and the mute
// state, and exposes the player-facing operations: scan(), next(), prev(),
// toggleMute() and stop(). It builds pings from the current room with the pure
// mapping, voices them through the thin audio layer (lazily created once an
// AudioContext exists), and writes every functional line — the scan summary and
// each step's text equivalent — to the player's single polite live region, so
// the player's own screen reader reads them.
//
// Text is always complete on its own: the summary and step lines are written
// whether or not audio plays (muted, or no context), so a player with sound off
// or no audio device still gets the full picture (R4.3, R5.4, R5.5). stop()
// cancels any scan's sound and suppresses its pending summary (R5.1, R5.2); the
// player wires stop() into its shared stop-audio hook, so any key press ends a
// scan before the next action.

import type { RoomState } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import type { LiveRegion } from "../ui/live-region.js";
import { SonarAudio } from "./audio.js";
import { buildPings, GAP, type Ping } from "./mapping.js";

/** A small timer seam so tests can drive the pending summary deterministically. */
export interface Timer {
  set(fn: () => void, seconds: number): void;
  clear(): void;
}

/** The default timer: setTimeout in seconds, one pending timer at a time. */
class DefaultTimer implements Timer {
  private handle: ReturnType<typeof setTimeout> | undefined;
  set(fn: () => void, seconds: number): void {
    this.clear();
    this.handle = setTimeout(fn, Math.max(0, seconds) * 1000);
  }
  clear(): void {
    if (this.handle !== undefined) {
      clearTimeout(this.handle);
      this.handle = undefined;
    }
  }
}

export interface SonarDeps {
  /** The player's single polite live region; every sonar line goes here. */
  live: LiveRegion;
  /** The start-gate AudioContext, or undefined until/if one exists (R5.5). */
  getContext: () => AudioContext | undefined;
  /** Optional timer seam for the pending summary (defaults to setTimeout). */
  timer?: Timer;
}

export class Sonar {
  private readonly live: LiveRegion;
  private readonly getContext: () => AudioContext | undefined;
  private readonly timer: Timer;

  private state: RoomState | undefined;
  private list: Hotspot[] = [];
  /** Before-the-first, so the next next() lands on index 0 (R3.6). */
  private cursor = -1;
  private muted = false;
  private audio: SonarAudio | undefined;

  constructor(deps: SonarDeps) {
    this.live = deps.live;
    this.getContext = deps.getContext;
    this.timer = deps.timer ?? new DefaultTimer();
  }

  /**
   * Refresh the room sonar reads from and reset the step cursor (R2.6, R3.6).
   * Pings are rebuilt per action, so nothing is computed eagerly here.
   */
  setRoom(state: RoomState, list: Hotspot[]): void {
    this.state = state;
    this.list = list;
    this.cursor = -1;
  }

  /**
   * Scan: play one ping per visible thing left to right, then a summary line
   * (R2.1, R2.2). The summary is written as text regardless of audio (R2.3) and
   * scheduled after the last ping so it never overlaps (R2.4). An empty room
   * gets one "nothing here" line and no pings (R2.5).
   */
  scan(): void {
    const pings = this.pings();
    if (pings.length === 0) {
      this.timer.clear();
      this.live.announce("The room is empty.");
      return;
    }
    this.audioLayer()?.play(pings);
    const summary = summaryLine(pings);
    const lastOnset = pings[pings.length - 1].onset;
    // Write the summary just after the last ping's onset, so it follows the
    // pings. With no audio the delay is harmless; the text still lands.
    this.timer.set(() => this.live.announce(summary), lastOnset + GAP);
  }

  /** Step to the next thing: one ping, then its name, direction, distance (R3.1). */
  next(): void {
    this.step(+1);
  }

  /** Step to the previous thing (R3.2). */
  prev(): void {
    this.step(-1);
  }

  /** Toggle sonar sound and announce the new state as text (R5.3). */
  toggleMute(): void {
    this.muted = !this.muted;
    this.audio?.setMuted(this.muted);
    this.live.announce(this.muted ? "Sonar sound off." : "Sonar sound on.");
  }

  /**
   * Stop all sonar sound now and suppress a pending summary (R5.1, R5.2). The
   * player's shared stop-audio hook calls this on every key press.
   */
  stop(): void {
    this.timer.clear();
    this.audio?.stop();
  }

  // --- internals ---

  /** Step the cursor by +1/-1 with wrap, voice one ping, announce it (R3.1-R3.4). */
  private step(delta: number): void {
    const pings = this.pings();
    if (pings.length === 0) {
      this.live.announce("Nothing to step through.");
      return;
    }
    // Wrap. From the reset cursor (-1), next() lands on the first thing and
    // prev() on the last. A plain modulo of (-1 + delta) would send prev() to
    // index 1, not the last, so the reset state is handled explicitly.
    const n = pings.length;
    if (this.cursor < 0) {
      this.cursor = delta > 0 ? 0 : n - 1;
    } else {
      this.cursor = ((this.cursor + delta) % n + n) % n;
    }
    const ping = pings[this.cursor];
    this.audioLayer()?.playOne(ping);
    this.live.announce(`${ping.text}, ${this.cursor + 1} of ${n}`);
  }

  /** Build the current room's pings, or [] when no room is set. */
  private pings(): Ping[] {
    if (!this.state) return [];
    return buildPings(this.state, this.list);
  }

  /**
   * The audio layer, created lazily the first time a context exists. Returns
   * undefined when there is no context, so scan/step stay text-only (R5.5).
   */
  private audioLayer(): SonarAudio | undefined {
    if (!this.audio) {
      const ctx = this.getContext();
      if (!ctx) return undefined;
      this.audio = new SonarAudio(ctx);
      this.audio.setMuted(this.muted);
    }
    return this.audio;
  }
}

/** Compose "N things, left to right: A people, B objects, C exits" (R2.2). */
export function summaryLine(pings: Ping[]): string {
  const people = pings.filter((p) => p.kind === "person").length;
  const objects = pings.filter((p) => p.kind === "object").length;
  const exits = pings.filter((p) => p.kind === "exit").length;
  const parts: string[] = [];
  if (people > 0) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  if (objects > 0) parts.push(`${objects} ${objects === 1 ? "object" : "objects"}`);
  if (exits > 0) parts.push(`${exits} ${exits === 1 ? "exit" : "exits"}`);
  const total = pings.length;
  const noun = total === 1 ? "thing" : "things";
  return `${total} ${noun}, left to right: ${parts.join(", ")}.`;
}
