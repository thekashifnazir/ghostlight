// Typed model of the engine a11y layer's output lines.
//
// The layer emits newline-delimited, prefix-tagged lines (see
// .kiro/specs/engine-a11y-layer/design.md, "Data formats"). parse.ts reads them
// with the player's own parser and maps each event onto these `kind`-tagged
// types, which the replay fixtures and the property tests share.

/** A single object in a room, as the engine reports it. */
export interface A11yObject {
  num: number;
  name: string;
  rect?: [number, number, number, number];
  walkTo?: [number, number];
  visible?: boolean;
  door?: boolean;
  /** Present only for doors: the room this door leads to. */
  toRoom?: number;
}

/** An inventory entry in a diff (id plus resolved name). */
export interface InvEntry {
  id: number;
  name: string;
}

/** A spoken line with its on-screen text colour. */
export interface SaidLine {
  color: string;
  text: string;
}

/** A conversation choice. */
export interface Choice {
  n: number;
  text: string;
  used: boolean;
  /** Choice 4 always ends the conversation. */
  ends?: boolean;
}

/** `A11Y ` full room state, emitted on room entry and for `dump`/`state`. */
export interface RoomState {
  kind: "room";
  chapter: number;
  room: number;
  hero: { x: number; y: number };
  objects: A11yObject[];
  inventory: number[];
  flags: number[];
}

/** `A11Y_DIFF ` one "what changed" line after a command settles. */
export interface Diff {
  kind: "diff";
  cmd: string;
  /** Present only when the chapter changed, as [from, to]. */
  chapter?: [number, number];
  /** Present only when the room changed, as [from, to]. */
  room?: [number, number];
  /** The new room's objects, present when the room changed. */
  objects?: A11yObject[];
  appeared?: A11yObject[];
  disappeared?: A11yObject[];
  doors?: A11yObject[];
  /**
   * The hero's NEW point, present only when the command moved the hero (a walk
   * to a free point or through a door). Same point/space as RoomState.hero
   * (curX + curWidth/2, curY + curHeight). Sonar pans object pings relative to
   * this; omitted when the hero did not move.
   */
  hero?: { x: number; y: number };
  invAdded?: InvEntry[];
  invRemoved?: InvEntry[];
  /** Flag changes keyed by index string, value [from, to]. */
  flags?: Record<string, [number, number]>;
  said?: SaidLine[];
  /** false when nothing moved. */
  changed?: boolean;
}

export interface CmdEcho {
  kind: "cmd";
  text: string;
}

export interface ErrLine {
  kind: "err";
  text: string;
}

export interface TextLine {
  kind: "text";
  text: string;
  /** True for an A11Y_VTEXT line: an actor was speaking it aloud. */
  voiced?: boolean;
}

export interface ChoicesLine {
  kind: "choices";
  choices: Choice[];
}

export interface InvLine {
  kind: "inv";
  items: { id: number; name: string; look?: string }[];
}

export interface SavedLine {
  kind: "saved";
  slot: string;
}

/** `A11Y_PHASE`: the engine's own control phase. */
export interface PhaseLine {
  kind: "phase";
  phase: "control" | "busy" | "choice";
}

/** `A11Y_VEND`: an actor's recorded line ended or was skipped. */
export interface VoiceEndLine {
  kind: "voiceEnd";
}

/** `A11Y_VHOLD <ms>`: a reading pause began after a voiced line. */
export interface VoiceHoldLine {
  kind: "voiceHold";
  ms: number;
}

/** `A11Y_GAME_END`: the last chapter ended (no diff follows). */
export interface GameEndLine {
  kind: "gameEnd";
  said: SaidLine[];
}
/** `A11Y_EXIT`: the ending and credits are done; the engine is quitting. */
export interface ExitLine {
  kind: "exit";
}
export type A11yLine =
  | RoomState
  | Diff
  | CmdEcho
  | ErrLine
  | TextLine
  | ChoicesLine
  | InvLine
  | SavedLine
  | PhaseLine
  | VoiceEndLine
  | VoiceHoldLine
  | GameEndLine
  | ExitLine;
