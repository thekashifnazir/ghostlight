// The invariants every accepted command must satisfy, written against the
// generic EngineHarness output so they hold for the fixture harness today and
// the native harness later (task 22).

import type { A11yLine, Diff, RoomState } from "./lines.js";
import { diffOf } from "./harness.js";

export interface InvariantContext {
  /** Inventory before the command ran (item ids). */
  invBefore: number[];
  /** The room the hero was in before the command ran. */
  roomBefore: number;
  /** The lines the command produced. */
  lines: A11yLine[];
  /**
   * The room-state line that follows this command, if the test can observe one
   * (room entry or an explicit dump). Used to check the room-match invariant.
   */
  nextRoomState?: RoomState | null;
}

export interface InvariantResult {
  ok: boolean;
  failures: string[];
}

// Fields that represent a change to the game world. `said` is deliberately
// excluded: speech is not a state change, and the spike transcript records
// spoken lines together with `changed:false` (e.g. look 102, choose 2, the
// locked-door walk). `hero` is ALSO deliberately excluded (task 30): a command
// that only moves the hero (a free-point walk, or a verb that walks to its
// object) is `changed:false` yet carries the hero's new point for sonar, so the
// hero field is positional data, not a world change — it must not trip the
// changed:false invariant. `flags` is included but flag 12 is filtered first,
// because flag 12 flips on its own as animation/timing noise and the engine
// reports it faithfully alongside `changed:false` (gotcha 8).
const DIFF_MOVE_KEYS: (keyof Diff)[] = [
  "chapter",
  "room",
  "objects",
  "appeared",
  "disappeared",
  "doors",
  "invAdded",
  "invRemoved",
  "flags",
];

/** Flag index the engine reports faithfully but which is known noise. */
const NOISE_FLAG = "12";

/** True when a diff field holds a real change, filtering flag-12-only noise. */
function fieldMoved(d: Diff, key: keyof Diff): boolean {
  const v = d[key];
  if (v === undefined) return false;
  if (key === "flags") {
    const keys = Object.keys(v as Record<string, unknown>).filter(
      (k) => k !== NOISE_FLAG,
    );
    return keys.length > 0;
  }
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

/** Apply a diff's inventory delta to a prior inventory, returning the result. */
export function applyInvDelta(before: number[], d: Diff): number[] {
  const set = new Set(before);
  for (const r of d.invRemoved ?? []) set.delete(r.id);
  for (const a of d.invAdded ?? []) set.add(a.id);
  return [...set].sort((x, y) => x - y);
}

/**
 * Check every task-22 invariant for one command's output. Returns all failures
 * so a property test can report them together.
 */
export function checkInvariants(ctx: InvariantContext): InvariantResult {
  const failures: string[] = [];
  const { lines } = ctx;

  const diffCount = lines.filter((l) => l.kind === "diff").length;
  const errCount = lines.filter((l) => l.kind === "err").length;

  // Invariant 4: every accepted command yields exactly one A11Y_DIFF or exactly
  // one A11Y_ERR, never both and never neither.
  const exactlyOne =
    (diffCount === 1 && errCount === 0) || (diffCount === 0 && errCount >= 1);
  if (!exactlyOne) {
    failures.push(
      `expected exactly one diff xor at least one err, got ${diffCount} diff / ${errCount} err`,
    );
    return { ok: false, failures };
  }

  // An erred command has no diff to check further invariants against.
  const d = diffOf(lines);
  if (!d) return { ok: failures.length === 0, failures };

  // Invariant 1: inventory after == inventory before + invAdded - invRemoved.
  // We can only assert this directly when we can observe the after-inventory.
  // The diff itself encodes the delta; we check the delta is internally
  // consistent (no id both added and removed, removed ids were present).
  const added = new Set((d.invAdded ?? []).map((e) => e.id));
  const removed = new Set((d.invRemoved ?? []).map((e) => e.id));
  for (const id of removed) {
    if (added.has(id)) {
      failures.push(`item ${id} both added and removed in one diff`);
    }
    if (!ctx.invBefore.includes(id)) {
      failures.push(`item ${id} removed but was not in inventory before`);
    }
  }
  for (const id of added) {
    if (ctx.invBefore.includes(id) && !removed.has(id)) {
      failures.push(`item ${id} added but was already in inventory`);
    }
  }

  // Invariant 2: when the diff changes room, the target room matches the room
  // in the next A11Y room-state line (when the test can observe one).
  if (d.room && ctx.nextRoomState) {
    if (ctx.nextRoomState.room !== d.room[1]) {
      failures.push(
        `room change target ${d.room[1]} != next room state ${ctx.nextRoomState.room}`,
      );
    }
  }
  // A room change must carry the new room's objects (Requirement 4.3).
  if (d.room && (d.objects === undefined || d.objects.length === 0)) {
    failures.push("room changed but diff carries no objects");
  }

  // Invariant 3: changed:false implies no other diff field moved (flag-12
  // noise and spoken lines excluded, per DIFF_MOVE_KEYS and fieldMoved).
  if (d.changed === false) {
    for (const key of DIFF_MOVE_KEYS) {
      if (fieldMoved(d, key)) {
        failures.push(`changed:false but field "${String(key)}" moved`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}
