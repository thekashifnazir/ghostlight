// Sonar mapping (Requirement 1, pure).
//
// Turns a room state plus the room's hotspot list into one ordered array of
// Ping values: one per visible thing, left to right, each carrying its pan
// (from x relative to the hero), pitch (from y), distance attenuation and band
// (from distance to the hero), timbre (from kind), onset offset, and a
// ready-made text equivalent (name, kind, direction, distance).
//
// This module is pure: room state and hotspot list in, Ping[] out. No Web
// Audio, DOM, timers or engine access. The property tests pin the invariants
// here (ordering by centre x, pan within -1..1 and monotonic in x, exactly one
// ping per visible thing). Sonar is text only: the tones were removed on
// 17 Nov 2026, so the player reads pan (as direction), distance and text, and
// the sound fields (pitch, cutoff, gain, onset) are kept only as the spike's
// values.

import type { RoomState } from "../engine/adapter.js";
import type { Hotspot } from "../model/hotspot-list.js";

/** The three timbres a ping can carry. Hotspot `npc` maps to `person`. */
export type PingKind = "person" | "object" | "exit";

/** Distance to the hero, bucketed for the text equivalent. */
export type DistanceBand = "near" | "mid" | "far";

/** Direction from the hero, derived from pan sign, for the text equivalent. */
export type Direction = "left" | "ahead" | "right";

/**
 * One scheduled sound for one visible thing, plus its text equivalent. A Ping
 * is a plain value: the sonar controller announces
 * its `text`, and the tests assert on its fields.
 */
export interface Ping {
  /** Engine hotspot number — stable identity for tests and the step cursor. */
  num: number;
  /** Final spoken name, taken from the hotspot (already pack-resolved). */
  name: string;
  /** person | object | exit. */
  kind: PingKind;
  /** Rect centre x in engine coordinates — the sort key. */
  centreX: number;
  /** Stereo position, -1 (hard left) .. +1 (hard right), tanh(dx / PAN_SCALE). */
  pan: number;
  /** Oscillator frequency in Hz, from centre y (higher in room → higher). */
  freq: number;
  /** Lowpass cutoff in Hz; closes with distance (further → duller). */
  cutoff: number;
  /** Peak gain 0..1; drops a little with distance (further → quieter). */
  gain: number;
  /** Seconds from the scan start: index * GAP. */
  onset: number;
  /** Distance in px from the hero centre to the thing's centre. */
  distance: number;
  /** near | mid | far, from `distance`. */
  band: DistanceBand;
  /** left | ahead | right, from pan sign (dead-band around zero). */
  direction: Direction;
  /** The text equivalent: "DOOR, exit, left, near". */
  text: string;
}

/**
 * Pan scale: dx is divided by this before tanh. 120 px (the spike's value)
 * keeps the whole width of a 320-px room well inside -1..1 without saturating
 * several far things onto one side, while staying strictly increasing in dx.
 */
export const PAN_SCALE = 120;

/** Base oscillator frequency in Hz for a thing at the room's vertical middle. */
export const BASE_FREQ = 660;

/** Seconds between successive ping onsets in a scan (160+ ms of silence). */
export const GAP = 0.3;

/** Below this distance a thing is "near"; the cutoff and gain stay bright. */
export const NEAR_MAX = 90;

/** Between NEAR_MAX and this a thing is "mid"; beyond it is "far". */
export const MID_MAX = 180;

/** The brightest lowpass cutoff in Hz, used at distance 0. */
export const CUTOFF_NEAR = 6400;

/** The dullest lowpass cutoff in Hz, approached at the far end of the room. */
export const CUTOFF_FAR = 1100;

/**
 * Peak gain for the nearest thing. Kept at 1 (full-scale per ping); the extra
 * loudness that lifted pings over the game music came from the removed tone player's master
 * boost, not from pushing a single ping's gain past unity, so a near ping never
 * clips on its own.
 */
export const GAIN_NEAR = 1;

/**
 * Peak gain for the furthest thing (never silent, just quieter). Raised from
 * 0.55 so even the most distant, duckable ping stays clearly over the music
 * once the master boost is applied, while still reading as "further = quieter".
 */
export const GAIN_FAR = 0.7;

/**
 * Pan values whose magnitude is below this read as "ahead"; otherwise the sign
 * gives "left" or "right". A small dead-band so a thing almost in line with the
 * hero is not called "left" or "right" on a one-pixel offset.
 */
export const AHEAD_PAN = 0.08;

/** The diagonal of the 320x200 room, the largest distance used for scaling. */
const MAX_DISTANCE = Math.hypot(320, 200);

/** Map the hotspot kind to a ping kind (npc → person). */
function pingKind(kind: Hotspot["kind"]): PingKind {
  if (kind === "npc") return "person";
  if (kind === "exit") return "exit";
  return "object";
}

/** Rect centre x. */
function centreXOf(rect: readonly [number, number, number, number]): number {
  return rect[0] + rect[2] / 2;
}

/** Rect centre y. */
function centreYOf(rect: readonly [number, number, number, number]): number {
  return rect[1] + rect[3] / 2;
}

/** Linear interpolation clamped to [0, 1] on t. */
function lerp(a: number, b: number, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * clamped;
}

/** Bucket a distance into near / mid / far. */
function bandOf(distance: number): DistanceBand {
  if (distance <= NEAR_MAX) return "near";
  if (distance <= MID_MAX) return "mid";
  return "far";
}

/** Direction word from a pan value, with a dead-band around zero. */
function directionOf(pan: number): Direction {
  if (pan <= -AHEAD_PAN) return "left";
  if (pan >= AHEAD_PAN) return "right";
  return "ahead";
}

/**
 * Build the ordered Ping array for a room.
 *
 * Steps (all pure):
 *  1. select hotspots whose engine object is visible — one per hotspot number,
 *     so an invisible thing never gets a ping and a visible one gets exactly
 *     one, independent of how the list was built;
 *  2. sort ascending by rect centre x, then centre y for ties — the single
 *     source of left-to-right order that pan, onset and the step index follow;
 *  3. for each, compute pan (tanh of dx / PAN_SCALE), pitch (octave either side
 *     of BASE_FREQ from centre y), distance (to the hero) → cutoff, gain and
 *     band, direction from pan, onset from index, and the text equivalent.
 */
export function buildPings(state: RoomState, list: Hotspot[]): Ping[] {
  // Which hotspot numbers are visible in the current room state. The hotspot
  // list is normally visible-only, but re-checking here makes R1.1 true by
  // construction regardless of the list's provenance.
  const visible = new Set<number>();
  for (const obj of state.objects) {
    if (obj.visible) visible.add(obj.num);
  }

  const chosen = list.filter((h) => visible.has(h.num));

  // Strict left-to-right order: ascending centre x, then centre y for ties.
  chosen.sort(
    (a, b) => centreXOf(a.rect) - centreXOf(b.rect) || centreYOf(a.rect) - centreYOf(b.rect),
  );

  const hero = state.hero;

  return chosen.map((h, index) => {
    const centreX = centreXOf(h.rect);
    const centreY = centreYOf(h.rect);
    const kind = pingKind(h.kind);

    // Pan: tanh keeps it in (-1, 1) ⊂ [-1, 1] and strictly increasing in dx, so
    // left-to-right order survives in the stereo field (R1.3, R1.4).
    const dx = centreX - hero.x;
    const pan = Math.tanh(dx / PAN_SCALE);

    // Pitch: about an octave either side of BASE_FREQ across the 200-px height,
    // higher in the room (smaller y) → higher pitch (R1.5).
    const freq = BASE_FREQ * 2 ** ((100 - centreY) / 100);

    // Distance to the hero → duller and quieter as it grows (R1.6).
    const distance = Math.hypot(centreX - hero.x, centreY - hero.y);
    const t = distance / MAX_DISTANCE;
    const cutoff = lerp(CUTOFF_NEAR, CUTOFF_FAR, t);
    const gain = lerp(GAIN_NEAR, GAIN_FAR, t);
    const band = bandOf(distance);

    const direction = directionOf(pan);
    const text = `${h.name}, ${kind}, ${direction}, ${band}`;

    return {
      num: h.num,
      name: h.name,
      kind,
      centreX,
      pan,
      freq,
      cutoff,
      gain,
      onset: index * GAP,
      distance,
      band,
      direction,
      text,
    };
  });
}
