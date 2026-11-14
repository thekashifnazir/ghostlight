# Ghostlight

### A 1996 point-and-click adventure, played by ear and keyboard.

Ghostlight makes *Drascula: The Vampire Strikes Back*, the 1996 freeware point-and-click adventure, playable with a screen reader in a web browser. The real game runs in ScummVM, so room contents, exits, inventory and progress come straight from the engine, and your own screen reader reads back what happened.

Live: [ghostlight.kashifnazir.com/?live](https://ghostlight.kashifnazir.com/?live) · Demo video: coming (by 1 December) · Devpost: coming (by 4 December)

**Kiroween 2026 · category: Resurrection · November 2026**

Built with Kiro · ScummVM Drascula engine · TypeScript · Web Audio · ElevenLabs voice · Cloudflare + R2 hosting

> Ghostlight is a work in progress. All six chapters can be played to the final ending; room descriptions cover every room of chapters 1, 2, 3 and 5, and the rest of chapters 4 and 6 are being drafted.

## Try it in 60 seconds

1. Open **[ghostlight.kashifnazir.com/?live](https://ghostlight.kashifnazir.com/?live)** with your screen reader on. No account, no install.
2. Read the start screen, then press **L** to hear the room: where you are, what is here, and where you can go.
3. Use **Left** and **Right** to move through the things in the room in visual order, **Enter** or **Up** to interact, **Down** to examine, and **Tab** for your inventory. Stuck? Press **H** for a hint.

That is list mode, the main way to play. Typing a command such as `take the coins` is a shortcut on top of it, not the only way in.

## Keys

List mode is the primary interface and works from the keyboard alone. No mouse is needed anywhere.

| Key | What it does |
|---|---|
| **Left / Right** | move through the things in the room, in visual order |
| **Enter** or **Up** | interact with the current thing |
| **Down** | examine the current thing |
| **V** | more verbs for the current thing |
| **Tab** | inventory |
| **H** | hint |
| **L** | read the room again |
| **R** | repeat the last line |
| **S / N / P / M** | sonar: sweep, next, previous, summary |
| **F1** | Ghostlight's own help |

Typing plain English (`look`, `use the coins on the machine`, `go through the back door`) is a shortcut for players who prefer it, and it feeds the same commands as list mode.

## Why it's different

- **The game's own state, not a retelling.** Room contents, exits, inventory and progress flags come live from the ScummVM engine through a small patch, so what you hear is the real game, not a script written alongside it.
- **Nothing lives only on the canvas.** The game canvas is hidden from assistive technology. Every functional line goes to an ARIA live region as text, so your own screen reader, at your own speed, carries everything you need to play.
- **A reusable pack, not a one-off.** The accessibility data for a game is a documented JSON pack with a schema and a validator. Drascula is the first pack; the format is built so other ScummVM games can follow.
- **Help that knows where you are.** The ghost gives authored hints in three tiers, keyed to real progress, so a hint never reveals a puzzle you have not reached.

## How it works

**Engine a11y layer.** A small patch on the ScummVM Drascula engine (in `engine/`) emits text lines through the engine's own logging channel: an `A11Y` line on entering a room, an `A11Y_DIFF` line after each action, and `A11Y_TEXT` for spoken text. The room line reports objects, hotspot positions, exits and destinations, inventory and progress flags. Commands go in through a small command file, so verbs call the engine's own action code rather than clicking pixels.

**The player.** The page in `src/` is HTML and TypeScript with no framework. It runs list mode over the engine's state, parses typed commands into the same engine commands, and writes every functional line into an ARIA live region so the player's own screen reader speaks it. The game canvas is hidden from assistive technology; nothing a player needs exists only as pixels.

**The pack.** An accessibility pack (in `packs/`) is a per-game JSON file that supplies what the engine cannot: names and descriptions for rooms and exits, spoken names for hotspots, item names, fixes for leftover engine strings, cutscene descriptions, and progress milestones. The format is documented in `packs/FORMAT.md` with a JSON Schema and a cross-reference validator. `drascula-en.json` is the first pack and covers every room of chapters 1, 2, 3, 5 and 6 (chapter 1: rooms 62 and 63; chapter 2: 17 rooms; chapter 3: rooms 13 and 20; chapter 5: 10 rooms; chapter 6: 5 rooms), plus 10 of chapter 4's 21 rooms.

**Hints and the ghost voice.** Each milestone in the pack carries three hint tiers: a nudge that points at the area, a clue that names the place and the thing, and an answer that gives the exact action in game verbs. A hint is only offered once its prerequisites are reached and the milestone is not yet done, so it never reveals a puzzle the player has not got to. The hints are also voiced as an interruptible whisper, generated with the ElevenLabs API (the Alice voice on the `eleven_v4` model), layered on top of the text, which already works on its own.

**Sonar.** On a key press the player sweeps the current room: each object and exit is played in turn, panned left to right by screen position, with pitch for height and a filter for distance, followed by one summary line to a polite live region. All of it is synthesised with Web Audio, with no audio files.

**drascula-mcp.** A small MCP server (in `mcp/`) exposes the game as tools, one per verb, so an agent and the Playwright checks can drive the game through the engine's own command set. It imports the command serialiser and the line parser from `src/engine/`, so the player, the tests and the server share one contract.

## How Kiro was used

Ghostlight is built in Kiro. Two documents track that in detail: [`docs/kiro-features.md`](docs/kiro-features.md) lists each Kiro feature and where it is used, and [`docs/kiro-process.md`](docs/kiro-process.md) is a dated log of the work.

In short, the build uses spec-driven development (one spec per area, each going requirements to design to tasks), steering files for the accessibility and process rules, hooks for save-time and task-time checks, the `drascula-mcp` MCP server plus Playwright for UI checks, Kiro Powers (including a custom ScummVM Access power and ElevenLabs), a reusable workflow for spec verification, a custom verifier agent, and property-based tests for the parser, the pack, the hints, the engine diff and the sonar mapping.

Code is AI-generated under my direction in Kiro.

## Run it locally

### Prerequisites

- **Node.js and npm.** The repo pins Node **26** in [`.nvmrc`](.nvmrc) (`nvm use` picks it up). Tested on Node 26; older versions are untested.
- **Command-line tools.** Both build scripts are bash scripts and check for their tools up front. You need:
  - `bash`, `git`, `curl`, `unzip`, for `scripts/fetch.sh`.
  - `git`, `curl`, `python3`, plus `make` and `tar`, for `scripts/build-web.sh`. It fetches the Emscripten SDK (emsdk, pinned to 4.0.10) with `curl` and provides `emcc`/`emconfigure`/`emmake` itself, so you do **not** need Emscripten installed beforehand. `python3` generates the `/data` HTTP index.
  - The web build script is written for **macOS** (it sizes `make` jobs with `sysctl`; there is a `nproc` fallback for Linux).

The engine is **not** committed: `scummvm.wasm` is built locally from the patch in `engine/`, so the first run compiles ScummVM to WebAssembly.

### 1. Install dependencies

```sh
npm ci
```

Installs exactly what `package-lock.json` pins.

### 2. Fetch the game data and ScummVM source

The game data is **not** in this repository: it lands in `vendor/`, which is gitignored and never committed. Fetch it with:

```sh
scripts/fetch.sh            # fetch what is missing, verify checksums
scripts/fetch.sh --force    # re-fetch even if present
```

`fetch.sh` pulls a pinned ScummVM checkout plus the Drascula freeware game and Ogg audio packs from [ScummVM's official downloads](https://www.scummvm.org/games/#games-drascula), and verifies each download against a recorded **sha256** checksum, aborting on any mismatch.

### 3. Build the engine to WebAssembly

```sh
scripts/build-web.sh        # compile scummvm.wasm (slow the first time)
```

`build-web.sh` fetches the Emscripten SDK with `curl`, applies the `engine/` patch to a separate ScummVM tree, and compiles `scummvm.wasm` into `vendor/scummvm-web/build-emscripten/`. The first run is **slow**: it downloads and activates emsdk and builds the engine from source; later runs reuse the cached SDK and tree.

### 4. Run the player

```sh
npm run dev
```

This starts the Vite dev server on a fixed port. Open **http://localhost:5173/** in your browser (the port is pinned via `strictPort`, so it will not drift).

### Other scripts

```sh
npm test              # the player unit and property tests
npx tsc --noEmit      # typecheck
```

### Tests

Counts re-counted from the suites on 7 November 2026.

```sh
npm test              # player: 155 tests across 24 files, all passing
```

```sh
npm --prefix packs/tools test   # pack tools: 12 tests across 3 files, all passing
```

```sh
npm --prefix tests/engine test  # engine harness: 26 tests (24 passing); the two
                                # replay assertions are work in progress while the
                                # engine spec is still open
```

The player and pack suites use property-based tests (fast-check) alongside examples. Playwright drives the UI checks through `drascula-mcp`, and axe-core checks for accessibility violations across key states.

## Known limits

- The pack covers **chapters 1, 2, 3, 5 and 6** and 10 of chapter 4's 21 rooms (14 Nov). Every chapter can be played to the final ending, but the rest of the room descriptions are still being drafted, so players hear the engine's plainer names there.
- Music is **made quieter** under the ghost's voice and the narration, but it is not ducked out of the way with proper sidechaining yet.
- The hosted engine build will be **rebuilt after the engine spec closes**, so the live link can lag behind the engine patch in this repository.

## Credits and licences

This repository carries two licences: one for code, one for the pack text.

- **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)) covers all the code: the player, the parser, the pack format, the tools, the MCP server, the scummvm-access power, and the engine patch in `engine/` (see [`engine/COPYING`](engine/COPYING)), which modifies GPL ScummVM code, as does any wasm built from it. Use it, change it and share it; if you share or host a changed version, publish your changes under the same licence. It's the licence ScummVM uses.
- **CC BY-SA 4.0** (see [`packs/LICENSE`](packs/LICENSE)) covers the accessibility pack *data* in `packs/` (the `<gameId>-<lang>.json` files): the room and object descriptions, exit labels, hints and other authored text. Reuse and improve it with credit, and share your version under the same licence. The live site serves the corresponding source for the hosted engine at [`/source/`](https://ghostlight.kashifnazir.com/source/): the `engine/` files, `hooks.patch`, the pinned ScummVM commit, the build script and the GPL text.

A root [`NOTICE`](NOTICE) file records these.

The game data is not in this repository. *Drascula: The Vampire Strikes Back* is distributed as freeware through [ScummVM's official downloads](https://www.scummvm.org/games/#games-drascula), and a script fetches it with checksums; the hosted copy keeps the game's readme and a notice that it is modified. Ghostlight builds on ScummVM and does not claim ScummVM's own work as its own.

The ghost's hint lines are voiced with the [ElevenLabs](https://elevenlabs.io/) API.

## Accessibility notes

List mode, presenting the game as lists of objects, exits and inventory to move through, follows an idea Brandon Cole set out in [Adventuring Blind](https://www.brandoncole.net/?p=128) (August 2013), on how a blind player can work through a point-and-click adventure.

This project does not make claims about what blind or low-vision players need without a source. Two testers, a blind accessibility consultant and a moderator of the Games for Blind Gamers community, were sent the build on 11 November 2026, and longer sessions are planned for 22 to 27 November, so findings come from them rather than being asserted here.

## More

- [`docs/kiro-features.md`](docs/kiro-features.md) · [`docs/kiro-process.md`](docs/kiro-process.md) · [`packs/FORMAT.md`](packs/FORMAT.md) · [`mcp/README.md`](mcp/README.md) · [`LICENSE`](LICENSE) · [`NOTICE`](NOTICE) · [`packs/LICENSE`](packs/LICENSE)
