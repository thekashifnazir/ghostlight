// A fixture-backed oracle the property tests can drive with commands in any
// order. It answers from the pool of recorded steps across all four fixtures,
// and tracks a model of inventory and current room so the invariants can see
// the before-state and the next room state. This stands in for the native
// engine; the native harness will expose the same observations from the real
// process, so the property tests move over unchanged.

import type { A11yLine, Diff, RoomState } from "./lines.js";
import { diffOf } from "./harness.js";
import { applyInvDelta } from "./invariants.js";
import { FIXTURE_NAMES, loadFixture } from "./fixture.js";

export interface Observation {
  invBefore: number[];
  roomBefore: number;
  lines: A11yLine[];
  nextRoomState: RoomState | null;
}

/** A recorded command plus its lines, independent of fixture order. */
interface PooledStep {
  cmd: string;
  lines: A11yLine[];
  diff: Diff | null;
}

export class ReplayOracle {
  /** All accepted (diff-producing) commands available to drive. */
  readonly acceptedCommands: string[];
  private readonly byCmd = new Map<string, PooledStep>();
  private inv: number[];
  private room: number;

  constructor() {
    // The ch2-vending-machine fixture starts with a representative mid-game
    // inventory and room, a realistic seed for the model.
    const seed = loadFixture("ch2-vending-machine").start;
    this.inv = [...seed.inventory];
    this.room = seed.room;

    for (const name of FIXTURE_NAMES) {
      const fx = loadFixture(name);
      for (const step of fx.steps) {
        if (this.byCmd.has(step.cmd)) continue;
        this.byCmd.set(step.cmd, {
          cmd: step.cmd,
          lines: step.lines,
          diff: diffOf(step.lines),
        });
      }
    }
    // Only commands that produce a diff are "accepted"; error-only commands are
    // generated separately so we exercise the err branch of invariant 4.
    this.acceptedCommands = [...this.byCmd.values()]
      .filter((s) => s.diff !== null)
      .map((s) => s.cmd);
  }

  /**
   * Whether a command's recorded diff can validly apply to the current model
   * state. A recorded diff adds and removes specific inventory ids; replaying
   * it only makes sense when the removed ids are held and the added ids are
   * not. On the real engine an inapplicable command would produce a different
   * diff, so for the fixture oracle we simply treat it as not-applicable and
   * let the driver pick another. This keeps generated sequences valid, as the
   * task requires ("random valid command sequences").
   */
  applicable(cmd: string): boolean {
    const step = this.byCmd.get(cmd);
    if (!step) return false;
    if (!step.diff) return true; // erring commands are always "applicable"
    const held = new Set(this.inv);
    for (const r of step.diff.invRemoved ?? []) {
      if (!held.has(r.id)) return false;
    }
    for (const a of step.diff.invAdded ?? []) {
      // Adding an item already held, without also removing it, is invalid.
      const alsoRemoved = (step.diff.invRemoved ?? []).some(
        (r) => r.id === a.id,
      );
      if (held.has(a.id) && !alsoRemoved) return false;
    }
    return true;
  }

  /** Current model inventory, for drivers that want to pick applicable moves. */
  inventory(): number[] {
    return [...this.inv];
  }

  /** Commands recorded as producing an A11Y_ERR (no diff). */
  erringCommands(): string[] {
    return [...this.byCmd.values()]
      .filter((s) => s.diff === null)
      .map((s) => s.cmd);
  }

  /** Run one recorded command and return an Observation for the invariants. */
  run(cmd: string): Observation {
    const step = this.byCmd.get(cmd);
    if (!step) throw new Error(`oracle has no recorded command "${cmd}"`);

    const invBefore = [...this.inv];
    const roomBefore = this.room;

    // The room state that follows this command. On a real run a room change
    // settles with the new room's A11Y line; we synthesise it from the diff's
    // own target room and objects (Requirement 4.3), which is exactly what the
    // native engine prints. This is observed by the invariant for *this*
    // command, not a later one.
    let nextRoomState: RoomState | null = null;

    // Advance the model from the diff so later commands see the updated state.
    if (step.diff) {
      this.inv = applyInvDelta(this.inv, step.diff);
      if (step.diff.room) {
        this.room = step.diff.room[1];
        nextRoomState = {
          kind: "room",
          chapter: step.diff.chapter ? step.diff.chapter[1] : 0,
          room: step.diff.room[1],
          hero: { x: 0, y: 0 },
          objects: step.diff.objects ?? [],
          inventory: this.inv,
          flags: [],
        };
      }
    }

    return { invBefore, roomBefore, lines: step.lines, nextRoomState };
  }
}
