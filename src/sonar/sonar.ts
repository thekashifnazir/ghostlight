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
// or no audio device still gets the full picture (R4.3, R5.4, R5.5). The scan
// summary is announced synchronously, up front, before any ping plays, so a
// later key press can stop the pings' sound but can never cancel or swallow the
// summary text (R2.3, R5.1, R5.2). stop() only stops sound; the player wires it
// into its shared stop-audio hook, so any key press ends a scan's audio before
// the next action while leaving the already-announced summary intact.

import type { RoomState } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import type { LiveRegion } from "../ui/live-region.js";
import { SonarAudio } from "./audio.js";
import { buildPings, type Ping } from "./mapping.js";

export interface SonarDeps {
  /** The player's single polite live region; every sonar line goes here. */
  live: LiveRegion;
  /** The start-gate AudioContext, or undefined until/if one exists (R5.5). */
  getContext: () => AudioContext | undefined;
  /** The "worth a look" line, spoken after the scan summary, or undefined. */
  nudge?: () => string | undefined;
}

export class Sonar {
  private readonly live: LiveRegion;
  private readonly getContext: () => AudioContext | undefined;
  private readonly nudge: (() => string | undefined) | undefined;

  private state: RoomState | undefined;
  private list: Hotspot[] = [];
  /** Before-the-first, so the next next() lands on index 0 (R3.6). */
  private cursor = -1;
  private muted = false;
  private audio: SonarAudio | undefined;

  constructor(deps: SonarDeps) {
    this.live = deps.live;
    this.getContext = deps.getContext;
    this.nudge = deps.nudge;
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
   * Scan: announce the summary line up front, then play one ping per visible
   * thing left to right (R2.1, R2.2). The summary is written as text first and
   * synchronously, so it always lands regardless of audio and a later key press
   * that stops the pings can never cancel it (R2.3, R5.1, R5.2). An empty room
   * gets one "nothing here" line and no pings (R2.5).
   */
  scan(): void {
    const pings = this.pings();
    if (pings.length === 0) {
      this.live.announce("The room is empty.");
      return;
    }
    // Announce the summary immediately, before any ping, so the text is already
    // out when the pings start. stop() can silence the pings afterwards but has
    // nothing pending to swallow.
    const nudge = this.nudge?.();
    this.live.announce(nudge ? `${summaryLine(pings)} ${nudge}` : summaryLine(pings));
    this.audioLayer()?.play(pings);
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
   * Stop all sonar sound now (R5.1). The player's shared stop-audio hook calls
   * this on every key press. The scan summary was already announced
   * synchronously up front, so there is nothing pending for stop() to swallow
   * (R5.2) — this only silences audio.
   */
  stop(): void {
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
