// "Worth a look" nudge (always-on, gentle level of the two-level help). Pure.
//
// The room readout ends with one short suggestion so a player who does not know
// what to do next can keep exploring without pressing H. It reuses the hint
// core's target selection, so it is never ahead of the player, and it only ever
// speaks the milestone's nudge tier. The clue and answer tiers stay behind H.
//
//   - the target milestone lists the current room: "Worth a look: <nudge>"
//   - the target milestone is in other rooms: "Worth a look elsewhere: <room>",
//     naming the first listed room so the player knows where to go, no solution
//   - nothing is offered, or there is nothing safe to say: undefined

import type { Progress } from "../../packs/tools/src/hints.js";
import type { Pack } from "../../packs/tools/src/types.js";
import { selectTarget } from "./select.js";

/** True when the line is the in-room form, i.e. the nudge text was spoken. */
export const WORTH_A_LOOK_PREFIX = "Worth a look: ";
export const WORTH_A_LOOK_ELSEWHERE_PREFIX = "Worth a look elsewhere: ";

/** End a sentence on a full stop unless it already ends on punctuation. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The one "worth a look" line for this room, or undefined when nothing is
 * offered. Never uses the clue or answer text.
 */
export function worthALook(
  pack: Pack,
  progress: Progress,
  room: number,
  roomName: (room: number) => string | undefined,
): string | undefined {
  const target = selectTarget(pack, progress, room);
  if (!target) return undefined;

  const rooms = target.rooms ?? [];
  if (rooms.includes(room)) {
    const nudge = target.hints.nudge?.trim();
    if (!nudge) return undefined;
    return sentence(`${WORTH_A_LOOK_PREFIX}${nudge}`);
  }

  if (rooms.length === 0) return undefined;
  const name = roomName(rooms[0])?.trim();
  if (!name) return undefined;
  return sentence(`${WORTH_A_LOOK_ELSEWHERE_PREFIX}${name}`);
}
