// Which game the player runs. The page defaults to Drascula; `?game=queen`
// selects Flight of the Amazon Queen. Everything that differs between the two
// (launch arguments, save-file names, pack, flag count) lives here so the rest
// of the player asks one place instead of hardcoding Drascula.

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
