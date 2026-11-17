// Which game the player runs. The page defaults to Drascula; `?game=queen`
// selects Flight of the Amazon Queen. Everything that differs between the two
// (launch arguments, save-file names, pack, flag count) lives here so the rest
// of the player asks one place instead of hardcoding Drascula.

import { HERO_TARGET } from "../model/hero.js";

/** The games the player can run. */
export type GameId = "drascula" | "queen";

/** Everything the player needs to know about one game. */
export interface GameConfig {
  id: GameId;
  /** Human title, also used for the tab title. */
  title: string;
  /** The ScummVM game id passed on the command line. */
  scummvmId: string;
  /** Where the game data is mounted in the wasm file system. */
  dataDir: string;
  /** Save files are named `<savePrefix>.NNN`, NNN the slot zero-padded to 3. */
  savePrefix: string;
  /** Lower-case phrase that marks the engine's stock "no useful look" reply. */
  genericLookPhrase: string;
  /** Number of engine flags in the A11Y flags array. */
  flagCount: number;
  /** The accessibility pack to load, by file name under packs/. */
  pack: "drascula-en" | "queen-en";
  /** Target number of the hero for "use item on yourself"; absent if the game has none. */
  heroTarget?: number;
  /** Example phrase spoken in the command box announcement and help text. */
  commandExample: string;
  /**
   * The start screen's first sentences: what this page makes playable, and for
   * a game with only part of it described, how much (Kash, 17 Nov: say plainly
   * where the described part ends).
   */
  gateIntro: string;
  /** True when only part of the game is described; the gate's buttons then carry gateIntro as their description. */
  preview?: boolean;
}

export const DRASCULA: GameConfig = {
  id: "drascula",
  title: "Ghostlight: Drascula",
  scummvmId: "drascula",
  dataDir: "/data/games/drascula",
  savePrefix: "drascula",
  genericLookPhrase: "anything in particular",
  flagCount: 50,
  pack: "drascula-en",
  heroTarget: HERO_TARGET,
  commandExample: "talk to drunk",
  gateIntro:
    "Ghostlight makes Drascula playable with the keyboard and your screen reader.",
};

export const QUEEN: GameConfig = {
  id: "queen",
  title: "Ghostlight: Flight of the Amazon Queen",
  scummvmId: "queen",
  dataDir: "/data/games/queen",
  savePrefix: "queen",
  genericLookPhrase: "anything special",
  flagCount: 211,
  pack: "queen-en",
  commandExample: "look at chest",
  gateIntro:
    "Ghostlight makes Flight of the Amazon Queen playable with the keyboard and your screen reader. This is a preview. Only the hotel opening is described: 4 rooms, with hints. Past it, the game still runs and speaks, but you'll hear the game's own names, with no descriptions or hints.",
  preview: true,
};

/** The game named by the `game` query parameter; Drascula if missing or unknown. */
export function gameFromSearch(search: string): GameConfig {
  const value = new URLSearchParams(search).get("game");
  return value === "queen" ? QUEEN : DRASCULA;
}

/** The game for this page load, read from the current URL (Drascula without one). */
export function currentGame(): GameConfig {
  const search =
    typeof location !== "undefined" ? (location.search ?? "") : "";
  return gameFromSearch(search);
}
