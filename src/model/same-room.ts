// Same-room changes from one A11Y_DIFF: objects that appeared, disappeared, or
// whose door state changed (a passage opened or closed). The player rebuilds
// its hotspot list from the result, so a door that opens becomes an exit with
// its destination, and says so when the game itself said nothing.
import type { Diff, RoomObject } from "../engine/adapter.js";

/** True if the diff changes which objects are present, or any door. */
export function hasSameRoomChanges(diff: Diff): boolean {
  return Boolean(diff.appeared || diff.disappeared || diff.doors);
}

/** The room's objects after the diff's same-room changes. */
export function applySameRoomChanges(objects: RoomObject[], diff: Diff): RoomObject[] {
  const present = new Map(objects.map((o) => [o.num, o]));
  for (const o of diff.disappeared ?? []) present.delete(o.num);
  for (const o of diff.appeared ?? []) present.set(o.num, o);
  for (const o of diff.doors ?? []) present.set(o.num, o);
  return [...present.values()];
}

/** Hotspot numbers of doors this diff opened (now a visible way through). */
export function openedDoors(diff: Diff): number[] {
  return (diff.doors ?? []).filter((o) => o.door && o.visible).map((o) => o.num);
}
