// The ordered hotspot list (Requirements 1, 2, pure).
//
// Turns a room state plus the pack into one ordered list of hotspots: every
// visible object, person and exit, each once, in strict visual order (left to
// right by rect left edge, then top to bottom by rect top edge). Names come
// from the pack with text fixes and fallbacks; kinds split exits from objects
// and people. Duplicate names are made unique as the final step. This module
// is pure: room state and pack in, Hotspot[] out, no DOM or engine.

import type { HotspotKind, RoomObject, RoomState } from "../engine/adapter.js";
import type { Pack } from "./pack.js";
import { uniquifyNames } from "./naming.js";

export interface Hotspot {
  /** Engine hotspot number (the pack key). */
  num: number;
  /** object | npc | exit. */
  kind: HotspotKind;
  /** Final spoken name (pack + unique-duplicate suffix). */
  name: string;
  /** [x, y, w, h] in engine coordinates. */
  rect: [number, number, number, number];
  /** [x, y] walk-to point. */
  walkTo: [number, number];
  /** Destination room for an exit, when the pack or engine knows it. */
  toRoom?: number;
}

/** Resolve a hotspot's kind from the engine object and the pack. */
function resolveKind(obj: RoomObject, pack: Pack, room: number): HotspotKind {
  const packType = pack.objectType(room, obj.num);
  if (packType) return packType;
  // No pack entry: a door is an exit, everything else an object.
  return obj.door ? "exit" : "object";
}

/** Resolve a hotspot's base spoken name from the pack, with engine fallback. */
function resolveName(
  obj: RoomObject,
  kind: HotspotKind,
  pack: Pack,
  room: number,
): string {
  if (kind === "exit") {
    const label = pack.exitLabel(room, obj.num);
    if (label) return label;
  }
  const objName = pack.objectName(room, obj.num);
  if (objName) return objName;
  // Fall back to the engine's raw name with text fixes applied, else a plain
  // placeholder so nothing is nameless.
  const fixed = pack.applyTextFixes(obj.name, "hotspot", room);
  if (fixed && fixed.trim().length > 0) return fixed.toLowerCase();
  return `item ${obj.num}`;
}

/**
 * Build the ordered, de-duplicated, uniquely-named hotspot list for a room.
 *
 * Steps (all pure):
 *  1. take every visible object;
 *  2. resolve each kind (exit for doors / pack exits, npc / object otherwise)
 *     and spoken name (pack, then engine name + text fixes, then placeholder);
 *  3. sort strictly by rect left edge, then rect top edge — the single source
 *     of visual order;
 *  4. make duplicate spoken names unique.
 */
export function buildHotspotList(state: RoomState, pack: Pack): Hotspot[] {
  const room = state.room;

  // One entry per engine hotspot number. Drascula reuses a single object number
  // for two screen areas — e.g. room 12 (the chapter-2 street) has two BALCONY
  // rects both numbered 154. To the engine these are the same object: an action
  // keys on the number, so one entry is correct and a second would only produce
  // a spurious duplicate in list mode, sonar and the highlight. Keep the first
  // entry seen per number, warn once per room so the reuse is visible, and
  // continue. Never throw: this runs inside the printErr reader, where an
  // escaping exception strands the room change and wedges the player.
  const seen = new Set<number>();
  let warnedDuplicate = false;

  const hotspots: Hotspot[] = [];
  for (const obj of state.objects) {
    if (!obj.visible) continue;
    if (seen.has(obj.num)) {
      if (!warnedDuplicate) {
        console.warn(
          `duplicate hotspot number ${obj.num} in room ${room}; keeping the first entry (the engine acts by number, so the extra screen area is the same object)`,
        );
        warnedDuplicate = true;
      }
      continue;
    }
    seen.add(obj.num);

    const kind = resolveKind(obj, pack, room);
    const name = resolveName(obj, kind, pack, room);

    const hotspot: Hotspot = {
      num: obj.num,
      kind,
      name,
      rect: obj.rect,
      walkTo: obj.walkTo,
    };
    // A destination: prefer the pack's (it corrects scripted doorways), else
    // the engine's toRoom for a plain door.
    if (kind === "exit") {
      const packTo = pack.exitTo(room, obj.num);
      if (packTo != null) hotspot.toRoom = packTo;
      else if (obj.toRoom != null) hotspot.toRoom = obj.toRoom;
    } else if (obj.toRoom != null) {
      hotspot.toRoom = obj.toRoom;
    }

    hotspots.push(hotspot);
  }

  // Strict visual order: ascending rect left edge, then ascending rect top.
  hotspots.sort((a, b) => a.rect[0] - b.rect[0] || a.rect[1] - b.rect[1]);

  // Make duplicate spoken names unique as the final step.
  return uniquifyNames(hotspots);
}
