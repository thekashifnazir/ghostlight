# Ghostlight

Ghostlight makes *Drascula: The Vampire Strikes Back*, the 1996 freeware point-and-click adventure, playable with a screen reader in a web browser. The real game runs in ScummVM; room contents, exits, inventory and progress come straight from the engine, you type or speak what to do, and your own screen reader reads back what happened.

> Ghostlight is a work in progress. The name is a placeholder and the parts below are at different stages of completion.

## Play it

The web player lives at [ghostlight.kashifnazir.com/?live](https://ghostlight.kashifnazir.com/?live). Open the link, read the start screen with your screen reader, and type a command such as `look`, `take the coins`, or `go through the back door`. Everything is reachable from the keyboard alone, and no mouse is needed anywhere.

The game's own key bindings are listed on its F1 help screen. The player adds a few keys of its own for the accessibility layer: repeat the last line, interrupt speech and audio, and open list mode (arrow keys to move through what is here, Enter for an action menu). These are shown on the start screen.

## How it works

**Engine a11y layer.** A small patch on the ScummVM Drascula engine (in `engine/`) emits text lines through the engine's own logging channel: an `A11Y` line on entering a room, an `A11Y_DIFF` line after each action, and `A11Y_TEXT` for spoken text. The room line reports objects, hotspot positions, exits and destinations, inventory and progress flags. Commands go in through a small command file, so verbs call the engine's own action code rather than clicking pixels.

**The player.** The page in `src/` is HTML and TypeScript with no framework. It parses typed or spoken plain English into engine commands, reads the engine's lines, and writes every functional line into an ARIA live region so the player's own screen reader speaks it. The game canvas is hidden from assistive technology; nothing a player needs exists only as pixels.

**The pack.** An accessibility pack (in `packs/`) is a per-game JSON file that supplies what the engine cannot: names and descriptions for rooms and exits, spoken names for hotspots, item names, fixes for leftover engine strings, cutscene descriptions, and progress milestones. The format is documented in `packs/FORMAT.md` with a JSON Schema and a cross-reference validator. `drascula-en.json` is the first pack and covers chapters 1 and 2.

**Hints and the ghost voice.** Each milestone in the pack carries three hint tiers: a nudge that points at the area, a clue that names the place and the thing, and an answer that gives the exact action in game verbs. A hint is only offered once its prerequisites are reached and the milestone is not yet done, so it never reveals a puzzle the player has not got to. The hints are also voiced as an interruptible whisper, layered on top of the text, which already works on its own.

**Sonar.** On a key press the player sweeps the current room: each object and exit is played in turn, panned left to right by screen position, with pitch for height and a filter for distance, followed by one summary line to a polite live region. All of it is synthesised with Web Audio, with no audio files.

**drascula-mcp.** A small MCP server (in `mcp/`) exposes the game as tools, one per verb, so an agent, the Playwright checks and the survey crew can drive the game through the engine's own command set. It imports the command serialiser and the line parser from `src/engine/`, so the player, the tests and the server share one contract.

## How Kiro was used

Ghostlight is built in Kiro. Two documents track that in detail: [`docs/kiro-features.md`](docs/kiro-features.md) lists each Kiro feature and where it is used, and [`docs/kiro-process.md`](docs/kiro-process.md) is a dated log of the work.

In short, the build uses spec-driven development (one spec per area, each going requirements to design to tasks), steering files for the accessibility and process rules, hooks for save-time and task-time checks, the `drascula-mcp` MCP server plus Playwright and ElevenLabs over MCP, Kiro Powers (including a custom ScummVM Access power), a reusable workflow for spec verification, a custom verifier agent, and property-based tests for the parser, the pack, the hints, the engine diff and the sonar mapping.

## Credits and licences

The root of this repository is **MIT** (see `LICENSE`), so the player, the parser, the pack format and the tools are reusable.

The engine patch in `engine/` modifies GPL ScummVM code and so stays **GPL-3.0-or-later**, as does any wasm built from it.

The game data is not in this repository. *Drascula: The Vampire Strikes Back* is distributed as freeware through [ScummVM's official downloads](https://www.scummvm.org/games/#games-drascula), and a script fetches it with checksums; the hosted copy keeps the game's readme and a notice that it is modified. Ghostlight builds on ScummVM and does not claim ScummVM's own work as its own.

The ghost's hint lines are voiced with [ElevenLabs](https://elevenlabs.io/).

## Accessibility notes

The design of the typed command layer and the graded hints draws on Brandon Cole's 2013 "Adventuring Blind" design ideas on how a blind player can work through a point-and-click adventure. The exact source link is to be confirmed before submission; it is a placeholder here rather than a verified URL.

This project does not make claims about what blind or low-vision players need without a source. Where the design rests on an assumption, it is marked as such, and the plan is to check it with blind players through the survey rather than to assert it here.
