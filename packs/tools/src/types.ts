// TypeScript types mirrored from packs/schema.json (format v1).
// The schema is the source of truth; these types are for the tools' own use.

export type Direction = "left" | "right" | "ahead" | "back" | "up" | "down";
export type HotspotType = "object" | "exit" | "npc";
export type TextFixContext = "hotspot" | "dialogue" | "any";
export type TextFixMatch = "exact" | "substring";
export type TextFixReason = "spanish" | "typo" | "spelling" | "clarity";

/** A condition tree. Every present key must hold (AND). At least one key is required. */
export interface Condition {
  chapter?: number;
  room?: number | number[];
  /** Keyed by flag index as a string of digits, e.g. "20". */
  flags?: Record<string, number>;
  has?: number[];
  lacks?: number[];
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
  milestone?: string;
}

export interface Exit {
  label: string;
  to: number | null;
  direction?: Direction;
  opensWhen?: Condition;
  note?: string;
}

export interface RoomObject {
  name: string;
  type: HotspotType;
  description?: string;
  note?: string;
}

export interface Room {
  chapters: number[];
  name: string;
  short: string;
  long: string;
  seen: boolean;
  note?: string;
  /** Keyed by hotspot number as a string of digits. */
  exits: Record<string, Exit>;
  /** Keyed by hotspot number as a string of digits. */
  objects: Record<string, RoomObject>;
}

export interface Item {
  id: number;
  chapters: number[];
  name: string;
  description: string;
  note?: string;
}

export interface TextFix {
  from: string;
  to: string;
  context: TextFixContext;
  match?: TextFixMatch;
  rooms?: number[];
  reason: TextFixReason;
  note?: string;
}

export interface Chapter {
  name: string;
  startRoom: number;
  summary: string;
  note?: string;
}

export interface Cutscene {
  chapter: number;
  trigger: string;
  hasDialogue: boolean;
  description: string;
  seen: boolean;
  note?: string;
}

export interface Hints {
  nudge: string;
  clue: string;
  answer: string;
}

export interface Milestone {
  id: string;
  chapter: number;
  title: string;
  after?: string[];
  when?: Condition;
  end?: true;
  rooms?: number[];
  optional?: boolean;
  recap: string;
  hints: Hints;
  note?: string;
}

export interface GameInfo {
  engine: string;
  gameId: string;
  language: string;
  platform?: string;
  title?: string;
  variant?: string;
}

export interface PackInfo {
  version: string;
  updated: string;
  coverage: { chapters: number[] };
  speechLocale?: string;
  authors?: string[];
  licence?: string;
  notes?: string;
}

export interface Pack {
  $schema?: string;
  format: "scummvm-a11y-pack";
  formatVersion: string;
  game: GameInfo;
  pack: PackInfo;
  textFixes?: TextFix[];
  chapters?: Record<string, Chapter>;
  rooms: Record<string, Room>;
  items?: Item[];
  cutscenes?: Record<string, Cutscene>;
  milestones?: Milestone[];
}

// ---- Census (reference/census.json), the read-only coverage ground truth. ----

export interface CensusObject {
  num: number;
  name: string;
  rect: number[];
  walkTo: number[];
  visible: number;
  door: number;
  toRoom?: number;
  destPoint?: number[];
  exitId?: number;
}

export interface CensusRoom {
  room: number;
  objects: CensusObject[];
}

export interface DoorGate {
  chapter: number;
  doorObject: number;
  flag: number;
}

export interface Census {
  generated: string;
  exitGraph: Record<string, number[]>;
  doorGates: DoorGate[];
  roomChapters: Record<string, number[]>;
  chapterStartRooms: Record<string, number>;
  chapters: Record<string, number[]>;
  rooms: Record<string, CensusRoom>;
}

/** The engine's per-chapter progress flags are indices 0 to 49 (50 flags). */
export const FLAG_MIN = 0;
export const FLAG_MAX = 49;
