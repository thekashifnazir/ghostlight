// Shared shapes for the pack-coverage pipeline (spec: .kiro/specs/pack-coverage).
//
// The dump (stage 1/2) is the contract the draft step (stage 4) reads; the
// draft is what the review list (stage 5) is built from; the review list is
// what the merge step (stage 6) reads. These types are the seam between the
// engine-driving stages (which need the native transport) and the pure
// transforms (which do not), so draft/review/merge/coverage can be built and
// tested with no engine, from fixture dumps.
//
// Hotspot numbers are the engine's own per-room numbers (HotspotInfo has no id;
// the pack keys on the per-room hotspot number). They are strings of digits
// everywhere a JSON object is keyed by them, matching the pack format.

/** One hotspot as the engine's room-state snapshot reports it. */
export interface DumpHotspot {
  /** The engine's per-room hotspot number. */
  num: number;
  /** The engine's own (possibly Spanish or misspelt) name, verbatim. */
  rawName: string;
  /** Bounding rectangle [x1, y1, x2, y2] as the engine reports it. */
  rect: number[];
  /** 1 if the engine marks this hotspot a door (an exit), else 0. */
  door: number;
  /** Census destination room for a door, when the census has one. */
  toRoom?: number;
  /** Whether the hotspot is visible in the dumped state (engine `visible`). */
  visible: number;
}

/** Which verbs the engine answered for a hotspot, and its look text. */
export interface VerbProbe {
  num: number;
  /** Verbs that produced a diff (answered) rather than an A11Y_ERR. */
  answered: string[];
  /** Verbs the engine rejected for this hotspot. */
  rejected: string[];
  /** The game's own look text for this hotspot, verbatim, when produced. */
  lookText?: string;
}

/** The engine room-state snapshot written to packs/survey/<room>/state.json. */
export interface RoomDumpState {
  chapter: number;
  room: number;
  hero: number[];
  hotspots: DumpHotspot[];
  inventory: { id: number; name?: string }[];
  /** All 50 progress flags, index 0 to 49. */
  flags: number[];
}

/** Provenance of the engine probing, written to packs/survey/<room>/verbs.json. */
export interface RoomDumpVerbs {
  room: number;
  probes: VerbProbe[];
}

/** Provenance of the dump itself, written to packs/survey/<room>/meta.json. */
export interface RoomDumpMeta {
  room: number;
  chapter: number;
  /** The checkpoint slot the room was reached from. */
  checkpointSlot: number | null;
  /** ISO date the dump was taken. */
  date: string;
  /** An identifier for the engine build the dump came from. */
  engineBuild: string;
  /** Whether a screenshot was captured (screenshots are gitignored game art). */
  screenshot: boolean;
  /** Per-hotspot door flag and census destination, carried for draft + merge. */
  hotspots: { num: number; door: number; toRoom?: number }[];
}

/** How a description was authored. Carried through draft -> review. */
export type Provenance =
  | "drafted by Kiro from a screenshot"
  | "drafted by Kiro from game text only";

/** A proposed exit entry in the draft (keyed by hotspot number in draft-<ch>). */
export interface DraftExit {
  label: string;
  /** Census destination, or null when walking through ends a chapter/scene. */
  to: number | null;
  direction?: "left" | "right" | "ahead" | "back" | "up" | "down";
  note?: string;
}

/** A proposed object entry in the draft (keyed by hotspot number). */
export interface DraftObject {
  name: string;
  type: "object" | "exit" | "npc";
  description?: string;
  /** A translated label + textFix suggestion for a Spanish/misspelt raw name. */
  textFixSuggestion?: {
    from: string;
    to: string;
    reason: "spanish" | "typo" | "spelling" | "clarity";
  };
  note?: string;
}

/** A proposed room entry in the draft. */
export interface DraftRoom {
  room: number;
  chapters: number[];
  name: string;
  short: string;
  long: string;
  seen: boolean;
  provenance: Provenance;
  /** True when the pack already has an accepted entry for this room. */
  alreadyCovered: boolean;
  /** The existing pack entry's text, shown for comparison when alreadyCovered. */
  existing?: { name: string; short: unknown; long: unknown; seen: boolean };
  exits: Record<string, DraftExit>;
  objects: Record<string, DraftObject>;
}

/** packs/survey/draft-<chapter>.json */
export interface Draft {
  chapter: number;
  generated: string;
  /** Rooms the survey reached and dumped (one DraftRoom each). */
  rooms: DraftRoom[];
  /** Rooms the survey could not reach, with the reason, for the record. */
  unreached: { room: number; reason: string }[];
}

/** The status a reviewer sets on a review unit. */
export type ReviewStatus = "pending" | "accepted" | "rejected";

/** One reviewable unit: a room description, or one exit, or one object. */
export interface ReviewUnit {
  /** Stable key, e.g. "room:16", "exit:16:163", "object:16:183". */
  key: string;
  kind: "room" | "exit" | "object";
  room: number;
  /** Hotspot number for an exit/object unit; absent for a room unit. */
  hotspot?: number;
  status: ReviewStatus;
  provenance: Provenance;
  /** True when this unit corresponds to an already-accepted pack entry. */
  alreadyCovered: boolean;
  /** The proposed content for this unit (room fields, or an exit/object). */
  proposed: unknown;
  /** The existing pack content for this unit, when alreadyCovered. */
  existing?: unknown;
}

/** packs/survey/review-<chapter>.json */
export interface ReviewList {
  chapter: number;
  generated: string;
  units: ReviewUnit[];
}
