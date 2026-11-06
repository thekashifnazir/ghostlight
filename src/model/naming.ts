// Unique duplicate names (Requirement 2.5, gotcha 4).
//
// Where two or more hotspots resolve to the same spoken name, the player must
// give each a unique name so they can be told apart ("left door", "middle
// door", "right door"). Position words come from each hotspot's rect left edge
// within its name group, so the words match what a sighted player sees.

import type { Hotspot } from "./hotspot-list.js";

/** Position words for small groups; larger groups fall back to ordinals. */
const PAIR = ["left", "right"];
const TRIPLE = ["left", "middle", "right"];
const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

function positionWords(count: number): string[] {
  if (count === 2) return PAIR;
  if (count === 3) return TRIPLE;
  return ORDINALS;
}

/**
 * Return a new array of hotspots with duplicate spoken names made unique.
 * Hotspots with a one-of-a-kind name are unchanged. Within a duplicate group,
 * a position word (left/middle/right, then first/second/…) is prepended, in
 * ascending rect-left order so the words line up with the screen.
 */
export function uniquifyNames(hotspots: Hotspot[]): Hotspot[] {
  // Group indices by base name.
  const groups = new Map<string, number[]>();
  hotspots.forEach((h, i) => {
    const list = groups.get(h.name);
    if (list) list.push(i);
    else groups.set(h.name, [i]);
  });

  const out = hotspots.map((h) => ({ ...h }));

  for (const indices of groups.values()) {
    if (indices.length < 2) continue;

    // Order the group by rect left edge (then top), so position words map to
    // the visual left-to-right order within the group.
    const ordered = [...indices].sort((a, b) => {
      const ra = hotspots[a].rect;
      const rb = hotspots[b].rect;
      return ra[0] - rb[0] || ra[1] - rb[1];
    });

    const words = positionWords(ordered.length);
    ordered.forEach((idx, pos) => {
      const word = words[pos] ?? `${pos + 1}th`;
      out[idx].name = `${word} ${hotspots[idx].name}`;
    });
  }

  return out;
}
