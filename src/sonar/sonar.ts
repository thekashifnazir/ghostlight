// The sonar controller (Requirements 2, 3, 4, 5).
//
// Holds the current room state and hotspot list and the step cursor, and
// exposes the player-facing operations: scan(), next() and prev(). It builds
// pings from the current room with the pure mapping and writes every line (the
// scan summary and each step's name, direction and distance) to the player's
// single polite live region, so the player's own screen reader reads them.
//
// Sonar is text only. The first design also played each ping as a synthesised
// tone; those tones were removed on 17 Nov 2026 (see the sonar spec's
// descoped note), and S, N and P keep the text.

import type { RoomState } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";
import type { LiveRegion } from "../ui/live-region.js";
import { buildPings, type Ping } from "./mapping.js";

export interface SonarDeps {
  /** The player's single polite live region; every sonar line goes here. */
  live: LiveRegion;
  /** The "worth a look" line, spoken after the scan summary, or undefined. */
  nudge?: () => string | undefined;
}

export class Sonar {
  private readonly live: LiveRegion;
  private readonly nudge: (() => string | undefined) | undefined;

  private state: RoomState | undefined;
  private list: Hotspot[] = [];
  /** Before-the-first, so the next next() lands on index 0 (R3.6). */
  private cursor = -1;

  constructor(deps: SonarDeps) {
    this.live = deps.live;
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
   * Scan: announce the summary line, counting what is here left to right
   * (R2.2). An empty room gets one "nothing here" line (R2.5).
   */
  scan(): void {
    const pings = this.pings();
    if (pings.length === 0) {
      this.live.announce("The room is empty.");
      return;
    }
    const nudge = this.nudge?.();
    this.live.announce(nudge ? `${summaryLine(pings)} ${nudge}` : summaryLine(pings));
  }

  /** Step to the next thing: its name, direction and distance (R3.1). */
  next(): void {
    this.step(+1);
  }

  /** Step to the previous thing (R3.2). */
  prev(): void {
    this.step(-1);
  }

  // --- internals ---

  /** Step the cursor by +1/-1 with wrap and announce that thing (R3.1-R3.4). */
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
    this.live.announce(`${ping.text}, ${this.cursor + 1} of ${n}`);
  }

  /** Build the current room's pings, or [] when no room is set. */
  private pings(): Ping[] {
    if (!this.state) return [];
    return buildPings(this.state, this.list);
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
