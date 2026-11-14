// The engine adapter seam (Requirement 10).
//
// Every piece of game state, text, choice and inventory the player sees comes
// through this interface, and every command the player sends goes through it.
// The player depends only on this interface, so the live engine (LiveAdapter)
// and a replay of recorded logs (ReplayAdapter) are interchangeable.
//
// The data shapes mirror the engine a11y layer's A11Y line contract exactly
// (see engine/a11y.cpp and the engine-a11y-layer design), so both adapters
// produce identical EngineEvents. This file is dependency-free: both adapters
// and the model import these types.

/** The kind of a hotspot the player can focus. */
export type HotspotKind = "object" | "npc" | "exit";

/**
 * One room object, keyed on the engine's per-room hotspot number. The engine
 * reports one entry per hotspot number (A11Y `objects[]`).
 */
export interface RoomObject {
  /** Engine hotspot number (the pack key). */
  num: number;
  /** Raw engine name (ALL CAPS / Spanish in places; the pack overrides it). */
  name: string;
  /** [x, y, w, h] in engine coordinates. */
  rect: [number, number, number, number];
  /** [x, y] walk-to point in the same coordinate space as `rect`. */
  walkTo: [number, number];
  /** Whether the object is currently visible in the room. */
  visible: boolean;
  /** Whether the object is a door. */
  door: boolean;
  /** Destination room, present only for doors. */
  toRoom?: number;
}

/** A full room-state snapshot (the `A11Y { ... }` line). */
export interface RoomState {
  chapter: number;
  room: number;
  /** Hero foot/centre point, in the objects' coordinate space. */
  hero: { x: number; y: number };
  objects: RoomObject[];
  /** Item ids carried (in Drascula 7+, verb slots excluded by the engine). */
  inventory: number[];
  /** The game's progress flags, reported faithfully (50 in Drascula, 211 in Queen). */
  flags: number[];
}

/**
 * What changed after one command (the `A11Y_DIFF { ... }` line). Fields are
 * present only when relevant.
 */
export interface Diff {
  /** The command this diff responds to. */
  cmd: string;
  /** [from, to] when the chapter changed. */
  chapter?: [number, number];
  /** [from, to] when the room changed. */
  room?: [number, number];
  /** The new room's full object list, on a room change. */
  objects?: RoomObject[];
  /** Objects that became visible within the current room. */
  appeared?: RoomObject[];
  /** Objects that stopped being visible within the current room. */
  disappeared?: RoomObject[];
  /**
   * Objects in the current room whose door state changed (a passage opened or
   * closed), carrying their new `door` flag and `toRoom`.
   */
  doors?: RoomObject[];
  /**
   * The hero's NEW point, present only when the command moved the hero (a walk
   * to a free point or through a door). Same point and coordinate space as
   * RoomState.hero (curX + curWidth/2, curY + curHeight). Sonar pans object
   * pings relative to this; omitted when the hero did not move.
   */
  hero?: { x: number; y: number };
  /** Items gained, with the engine's name. */
  invAdded?: { id: number; name: string }[];
  /** Items lost or used up, with the engine's name. */
  invRemoved?: { id: number; name: string }[];
  /** Flags that changed, keyed by flag index: "19": [0, 1]. */
  flags?: Record<string, [number, number]>;
  /** Text spoken/drawn as a result, each with its engine colour. A line the
   *  game was speaking aloud (a voice sample playing) carries `voiced: true`. */
  said?: { color: string; text: string; voiced?: boolean }[];
  /** False when nothing moved. */
  changed: boolean;
}

/** One conversation choice (the `A11Y_CHOICES` line). */
export interface Choice {
  n: number;
  text: string;
  /** Already said earlier in this conversation. */
  used?: boolean;
  /** Choosing this ends the conversation. */
  ends?: boolean;
}

/** One inventory item with its engine name and look text (the `A11Y_INV` line). */
export interface InvItem {
  id: number;
  name: string;
  look?: string;
}

/**
 * The engine's own control phase (the `A11Y_PHASE` line). Emitted by the engine
 * a11y layer straight from engine truth, not inferred by the player:
 *   - `control` — the engine is idle in free play and able to take a command
 *     this frame, judged per game (not `canSaveGameStateCurrently()`).
 *   - `busy`    — a command is running / the engine is not ready.
 *   - `choice`  — a conversation choice menu is open and waiting.
 * The player maps these onto its readiness phase (see src/engine/status.ts).
 */
export type EnginePhase = "control" | "busy" | "choice";

/** A typed event produced by parsing one A11Y line. */
export type EngineEvent =
  | { type: "room"; state: RoomState }
  | { type: "diff"; diff: Diff }
  // `voiced` is true for an A11Y_VTEXT line — a line the game was speaking aloud
  // (a voice sample playing). The player suppresses the screen-reader echo of a
  // voiced line by default. An A11Y_TEXT line leaves `voiced` undefined/false.
  | { type: "text"; line: string; voiced?: boolean }
  | { type: "choices"; choices: Choice[] }
  | { type: "inv"; items: InvItem[] }
  | { type: "cmd"; cmd: string }
  | { type: "error"; message: string }
  | { type: "saved"; slot: number }
  | { type: "phase"; phase: EnginePhase }
  // The last chapter ended (`A11Y_GAME_END`): the ending scene's spoken lines.
  // The engine runs the credits and then exits on its own.
  | { type: "gameEnd"; said: { color: string; text: string; voiced?: boolean }[] }
  // The engine stopped after the credits: the bare `A11Y_EXIT` line, or the
  // Emscripten runtime's onExit (synthesised by the live adapter).
  | { type: "engineExit" }
  // An actor's recorded line has ended (`A11Y_VEND`): the voice sample stopped
  // or a skip cut it short. One per voiced clip.
  | { type: "voiceEnd" }
  // The engine began a reading pause of `ms` after a voiced line
  // (`A11Y_VHOLD <ms>`, only when `readpause on` was sent).
  | { type: "voiceHold"; ms: number };

/** The engine verbs that target a single hotspot number. */
export type TargetVerb =
  | "look"
  | "take"
  | "open"
  | "close"
  | "talk"
  | "push"
  | "walk";

/**
 * A command the player sends to the engine. Targets are hotspot numbers or
 * item ids, never pixels.
 */
export type Command =
  | { verb: TargetVerb; target: number }
  | { verb: "use"; item: number; target: number } // target: hotspot num or item id
  | { verb: "inventory" }
  | { verb: "choices" }
  | { verb: "choose"; n: number }
  | { verb: "skip" }
  // Reading pause after voiced lines (engine/a11y.cpp `readpause`). Off by
  // default in the engine; the player sends it when D is on.
  | { verb: "readpause"; on: boolean }
  | { verb: "save"; slot: number }
  // Re-request the engine's full room state. The engine re-emits the current
  // room as an `A11Y` line (engine/a11y.cpp `state`/`dump`), which the player
  // handles exactly like a room entry. Used to re-sync the player's room model
  // with engine truth after an error shows the two have drifted (an object the
  // player listed is no longer in the engine's room). It changes no game state.
  | { verb: "state" };

/**
 * The seam the player talks to the engine through. `start()` boots and emits
 * up to the first room state; `send()` issues a command; `onEvent()` subscribes
 * and returns an unsubscribe function.
 */
export interface EngineAdapter {
  start(): Promise<void>;
  send(cmd: Command): void;
  onEvent(listener: (e: EngineEvent) => void): () => void;
}

/** Serialise a command to the engine's command-file line form (verb + args). */
export function serializeCommand(cmd: Command): string {
  switch (cmd.verb) {
    case "use":
      return `use ${cmd.item} ${cmd.target}`;
    case "inventory":
      return "inventory";
    case "choices":
      return "choices";
    case "choose":
      return `choose ${cmd.n}`;
    case "skip":
      return "skip";
    case "readpause":
      return cmd.on ? "readpause on" : "readpause off";
    case "save":
      return `save ${cmd.slot}`;
    case "state":
      return "state";
    default:
      return `${cmd.verb} ${cmd.target}`;
  }
}
