<div align="center">

# 👻 Ghostlight

**A 1996 point-and-click adventure, played by ear and keyboard.<br>The real game runs in ScummVM in your browser, and your own screen reader tells you what's in the room and what just happened.**

_Kiroween 2026 · Resurrection · Companion: [Ghostlight Survey Crew](https://github.com/thekashifnazir/ghostlight-crew)_

![Licence: GPL-3.0-or-later](https://img.shields.io/badge/licence-GPL--3.0--or--later-4c9a2a)
![Pack text: CC BY-SA 4.0](https://img.shields.io/badge/pack_text-CC_BY--SA_4.0-4c9a2a)
![Built with Kiro](https://img.shields.io/badge/built_with-Kiro-7b3fe4)
![Engine: ScummVM](https://img.shields.io/badge/engine-ScummVM-2453b8)
![Frozen for judging](https://img.shields.io/badge/status-frozen_for_judging-555555)

[**Play it**](https://ghostlight.kashifnazir.com/?live) · [**Demo video (3 min)**](https://youtu.be/gfpjhE8Vopw) · [**Devpost**](https://devpost.com/software/ghostlight-quizte) · [**How it works**](#4-how-it-works) · [**Run it locally**](#7-run-it-locally) · [**The Crew**](https://github.com/thekashifnazir/ghostlight-crew)

</div>

<p align="center">
  <a href="https://youtu.be/gfpjhE8Vopw"><img src="docs/ghostlight-preview.gif" width="720" alt="Silent preview of the Ghostlight video: VoiceOver reads the inn bar, Right arrow moves to &quot;bartender, 5 of 10&quot;, then the room's nudge: &quot;It's late, and you'll need somewhere to sleep.&quot;"></a>
  <br>
  <sub>▶ Silent preview. <a href="https://youtu.be/gfpjhE8Vopw"><b>Watch the full video with sound</b></a> · <a href="https://ghostlight.kashifnazir.com/?live"><b>Play it now</b></a></sub>
</p>

> **In 30 seconds.** Ghostlight makes *Drascula: The Vampire Strikes Back*, the 1996 freeware point-and-click adventure, playable with a screen reader in a web browser. The real game runs in ScummVM, so room contents, exits, inventory and progress come straight from the engine, and your own screen reader reads back what happened. Chad Bouton, a blind accessibility consultant and co-host of The Unsyted Radio podcast, played it start to finish with a screen reader on 16 Nov. He wrote afterwards: "it works beautifully! I was actually able to complete the entire game." Code is AI-generated under my direction in Kiro.

| **57 of 57** rooms described | **6 of 6** chapters to the ending | **10** screen reader and browser pairs | **195** hint lines voiced | **86 of 389** commits by Kiro Agent |
|:---:|:---:|:---:|:---:|:---:|
| every room has a description<br><sub>14 Nov</sub> | hints in every chapter<br><sub>16 Nov</sub> | NVDA, JAWS and VoiceOver<br><sub>Windows 11 and macOS</sub> | the ghost's whisper, ElevenLabs<br><sub>16 Nov</sub> | every step logged<br><sub>counted 23 Nov</sub> |

<sub>Ghostlight is frozen for Kiroween 2026 judging. Tested with NVDA in Chrome, Edge and Firefox, JAWS in Chrome, Edge and Firefox (Windows 11), and VoiceOver in Chrome, Edge, Safari and Firefox (macOS).</sub>

> 💡 Every section below opens with a one-line answer. Click any ▸ line to unfold the detail.

## Contents

1. [Try it in 60 seconds](#1-try-it-in-60-seconds)
2. [Keys](#2-keys)
3. [Why it's different](#3-why-its-different)
4. [How it works](#4-how-it-works)
5. [How Kiro was used](#5-how-kiro-was-used)
6. [Beyond Drascula](#6-beyond-drascula)
7. [Run it locally](#7-run-it-locally)
8. [Known limits](#8-known-limits)
9. [Credits and licences](#9-credits-and-licences)
10. [Accessibility notes](#10-accessibility-notes)

---

## 1. Try it in 60 seconds

**Turn your screen reader on, open the link, and press L.** No account, no install.

1. Open **[ghostlight.kashifnazir.com/?live](https://ghostlight.kashifnazir.com/?live)** with your screen reader on.
2. Read the start screen, then press **L** to hear the room: where you are, what is here, and where you can go.
3. Use **Left** and **Right** to move through the things in the room in visual order, **Enter** or **Up** to interact, **Down** to examine, and **Tab** for your inventory. Stuck? Press **H** for a hint.

That is list mode, the main way to play. Typing a command such as `take the coins` is a shortcut on top of it, not the only way in.

## 2. Keys

**Everything works from the keyboard alone. No mouse is needed anywhere.**

<details>
<summary><b>The full key list</b></summary>

<br>

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
| **S / N / P** | sonar: count what's in the room, next thing, previous thing |
| **F1** | Ghostlight's own help |
| **C / O** | save now / load your latest save |
| **Q** (twice) | save and go back to the start screen, where you can choose any chapter you've reached |
| **/** | type a command in plain English |

Typing plain English (`look`, `use the coins on the machine`, `go through the back door`) is a shortcut for players who prefer it, and it feeds the same commands as list mode.

</details>

## 3. Why it's different

**What you hear is the real 1996 game, read by your own screen reader, not a retelling.**

<details>
<summary><b>Four things that set it apart</b></summary>

<br>

- **The game's own state, not a retelling.** Room contents, exits, inventory and progress flags come live from the ScummVM engine through a small patch, so what you hear is the real game, not a script written alongside it.
- **Nothing lives only on the canvas.** The game canvas is hidden from assistive technology. Every functional line goes to an ARIA live region as text, so your own screen reader, at your own speed, carries everything you need to play.
- **A reusable pack, not a one-off.** The accessibility data for a game is a documented JSON pack with a schema and a validator. Drascula is the first pack; the format is built so other ScummVM games can follow.
- **Help that knows where you are.** The ghost gives authored hints in three tiers, keyed to real progress, so a hint never reveals a puzzle you have not reached.

</details>

## 4. How it works

**A small engine patch reports each room as text, the page turns it into lists, and a per-game pack fills in what the engine can't say.**

<details>
<summary><b>Engine a11y layer</b></summary>

<br>

A small patch on the ScummVM Drascula engine (in `engine/`) emits text lines through the engine's own logging channel: an `A11Y` line on entering a room, an `A11Y_DIFF` line after each action, and `A11Y_TEXT` for spoken text. The room line reports objects, hotspot positions, exits and destinations, inventory and progress flags. Commands go in through a small command file, so verbs call the engine's own action code rather than clicking pixels.

</details>

<details>
<summary><b>The player</b></summary>

<br>

The page in `src/` is HTML and TypeScript with no framework. It runs list mode over the engine's state, parses typed commands into the same engine commands, and writes every functional line into an ARIA live region so the player's own screen reader speaks it. The game canvas is hidden from assistive technology; nothing a player needs exists only as pixels.

</details>

<details>
<summary><b>The pack</b></summary>

<br>

An accessibility pack (in `packs/`) is a per-game JSON file that supplies what the engine cannot: names and descriptions for rooms and exits, spoken names for hotspots, item names, fixes for leftover engine strings, cutscene descriptions, and progress milestones. The format is documented in `packs/FORMAT.md` with a JSON Schema and a cross-reference validator. `drascula-en.json` is the first pack and covers every one of the game's 57 rooms (chapter 1: rooms 62 and 63; chapter 2: 17 rooms; chapter 3: rooms 13 and 20; chapter 4: 21 rooms; chapter 5: 10 rooms; chapter 6: 5 rooms).

</details>

<details>
<summary><b>Hints and the ghost voice</b></summary>

<br>

Each milestone in the pack carries three hint tiers: a nudge that points at the area, a clue that names the place and the thing, and an answer that gives the exact action in game verbs. A hint is only offered once its prerequisites are reached and the milestone is not yet done, so it never reveals a puzzle the player has not got to. The hints are also voiced as an interruptible whisper, generated with the ElevenLabs API (the Alice voice on the `eleven_v4` model), layered on top of the text, which already works on its own. Every hint is voiced (195 lines, 16 Nov), including chapters 3 to 6, which were added after a tester got stuck in chapter 4.

</details>

<details>
<summary><b>Sonar</b></summary>

<br>

S gives a quick spoken count of the room, left to right ("10 things, left to right: 3 people, 4 objects, 3 exits."), and N and P step through the things one at a time with each one's direction and distance. It's text, read by your screen reader. The first design also played a tone for each thing, panned by position. The tones were removed, because more sound on top of the music, the ghost voice and the screen reader would get in the way.

</details>

<details>
<summary><b>drascula-mcp</b></summary>

<br>

A small MCP server (in `mcp/`) exposes the game as tools, one per verb, so an agent and the Playwright checks can drive the game through the engine's own command set. It imports the command serialiser and the line parser from `src/engine/`, so the player, the tests and the server share one contract.

</details>

## 5. How Kiro was used

**Built in Kiro, spec by spec: 86 of 389 commits are by Kiro Agent, and every step is in a dated log.**

<details>
<summary><b>Features used, and where the record lives</b></summary>

<br>

Two documents track this in detail: [`docs/kiro-features.md`](docs/kiro-features.md) lists each Kiro feature and where it is used, and [`docs/kiro-process.md`](docs/kiro-process.md) is a dated log of the work.

In short, the build uses spec-driven development (one spec per area, each going requirements to design to tasks), steering files for the accessibility and process rules, hooks for save-time and task-time checks, the `drascula-mcp` MCP server plus Playwright for UI checks, Kiro Powers (including a custom ScummVM Access power and ElevenLabs), a reusable workflow for spec verification, a custom verifier agent, and property-based tests for the parser, the pack, the hints, the engine diff and the sonar mapping.

86 of 389 commits are by Kiro Agent, and the IDE sessions commit under my name; every step is in [`docs/kiro-process.md`](docs/kiro-process.md) (counted 23 Nov). Code is AI-generated under my direction in Kiro.

The [Ghostlight Survey Crew](https://github.com/thekashifnazir/ghostlight-crew), a Kiro Crew, surveyed rooms overnight, drafted pack entries for human approval and replays the whole game.

</details>

## 6. Beyond Drascula

**A second ScummVM game, Flight of the Amazon Queen, opens from the same build with [`?game=queen`](https://ghostlight.kashifnazir.com/?game=queen).**

<details>
<summary><b>What works in the second game, and what's next</b></summary>

<br>

Flight of the Amazon Queen is in as a second-engine proof: the hotel opening (4 rooms) is described, has hints, and was surveyed by the Crew. Past it the game still runs and speaks, but rooms are read by the game's own object names, with no descriptions or hints. The start screen says so. The jungle map further on needs a mouse, so play stops there.

The accessibility pack is a documented format with a schema and a validator, so another ScummVM game needs a pack and an engine layer, not a new player.

The work carries on in QuestAloud: bring-your-own-game tooling that lets anyone who owns a classic point-and-click adventure play it with a screen reader, built so an AI can walk a game and draft its accessibility pack. It's in progress and private for now, and will go public later. Ghostlight stays frozen at the submitted build for judging.

</details>

## 7. Run it locally

**`npm ci`, fetch the game, build the engine once, then `npm run dev` and open http://localhost:5173/.**

<details>
<summary><b>Prerequisites</b></summary>

<br>

- **Node.js and npm.** The repo pins Node **26** in [`.nvmrc`](.nvmrc) (`nvm use` picks it up). Tested on Node 26; older versions are untested.
- **Command-line tools.** Both build scripts are bash scripts and check for their tools up front. You need:
  - `bash`, `git`, `curl`, `unzip`, for `scripts/fetch.sh`.
  - `git`, `curl`, `python3`, plus `make` and `tar`, for `scripts/build-web.sh`. It fetches the Emscripten SDK (emsdk, pinned to 4.0.10) with `curl` and provides `emcc`/`emconfigure`/`emmake` itself, so you do **not** need Emscripten installed beforehand. `python3` generates the `/data` HTTP index.
  - The web build script is written for **macOS** (it sizes `make` jobs with `sysctl`; there is a `nproc` fallback for Linux).

The engine is **not** committed: `scummvm.wasm` is built locally from the patch in `engine/`, so the first run compiles ScummVM to WebAssembly.

</details>

<details>
<summary><b>Steps 1 to 4: install, fetch, build, run</b></summary>

<br>

**1. Install dependencies**

```sh
npm ci
```

Installs exactly what `package-lock.json` pins.

**2. Fetch the game data and ScummVM source**

The game data is **not** in this repository: it lands in `vendor/`, which is gitignored and never committed. Fetch it with:

```sh
scripts/fetch.sh            # fetch what is missing, verify checksums
scripts/fetch.sh --force    # re-fetch even if present
```

`fetch.sh` pulls a pinned ScummVM checkout plus the Drascula freeware game and Ogg audio packs from [ScummVM's official downloads](https://www.scummvm.org/games/#games-drascula), and verifies each download against a recorded **sha256** checksum, aborting on any mismatch.

**3. Build the engine to WebAssembly**

```sh
scripts/build-web.sh        # compile scummvm.wasm (slow the first time)
```

`build-web.sh` fetches the Emscripten SDK with `curl`, applies the `engine/` patch to a separate ScummVM tree, and compiles `scummvm.wasm` into `vendor/scummvm-web/build-emscripten/`. The first run is **slow**: it downloads and activates emsdk and builds the engine from source; later runs reuse the cached SDK and tree.

**4. Run the player**

```sh
npm run dev
```

This starts the Vite dev server on a fixed port. Open **http://localhost:5173/** in your browser (the port is pinned via `strictPort`, so it will not drift).

</details>

<details>
<summary><b>Tests</b></summary>

<br>

Counts re-counted from the suites on 23 November 2026, on the frozen build.

```sh
npm test                        # player: 594 tests across 73 files, all passing
npm --prefix packs/tools test   # pack tools: 43 tests across 7 files, all passing
npm --prefix tests/engine test  # engine harness: 43 passing, 2 skipped, across 11 files
npm --prefix mcp test           # drascula-mcp: 70 tests across 18 files, all passing
npx tsc --noEmit                # typecheck
```

Playwright: 86 replay checks against the dev server, and 16 live checks that boot the real engine in Chromium, all passing.

The player and pack suites use property-based tests (fast-check) alongside examples. Playwright drives the UI checks through `drascula-mcp`, and axe-core checks for accessibility violations across key states.

</details>

## 8. Known limits

**Every room and chapter is covered; the music isn't properly ducked under speech yet.**

<details>
<summary><b>Details</b></summary>

<br>

- The pack covers **every room in all six chapters**, 57 of 57 (14 Nov), and has hints for every chapter (16 Nov). Every chapter can be played to the final ending.
- Every hint answer has been followed in the real engine by the Crew's hint walker (61 of 65 passed, 17 Nov), and a blind tester finished the whole game on 16 Nov.
- Music is **made quieter** under the ghost's voice and the narration, but it is not ducked out of the way with proper sidechaining yet.
- Not yet tested: Narrator, Orca, and phone screen readers.

</details>

## 9. Credits and licences

**Code is GPL-3.0-or-later, the same as ScummVM; the pack text is CC BY-SA 4.0. The game data is not in this repository.**

<details>
<summary><b>Licences, game data and credits</b></summary>

<br>

This repository carries two licences: one for code, one for the pack text.

- **GPL-3.0-or-later** (see [`LICENSE`](LICENSE)) covers all the code: the player, the parser, the pack format, the tools, the MCP server, the scummvm-access power, and the engine patch in `engine/` (see [`engine/COPYING`](engine/COPYING)), which modifies GPL ScummVM code, as does any wasm built from it. Use it, change it and share it; if you share or host a changed version, publish your changes under the same licence. It's the licence ScummVM uses.
- **CC BY-SA 4.0** (see [`packs/LICENSE`](packs/LICENSE)) covers the accessibility pack *data* in `packs/` (the `<gameId>-<lang>.json` files): the room and object descriptions, exit labels, hints and other authored text. Reuse and improve it with credit, and share your version under the same licence. The live site serves the corresponding source for the hosted engine at [`/source/`](https://ghostlight.kashifnazir.com/source/): the `engine/` files, `hooks.patch`, the pinned ScummVM commit, the build script and the GPL text.

A root [`NOTICE`](NOTICE) file records these.

The game data is not in this repository. *Drascula: The Vampire Strikes Back* is distributed as freeware through [ScummVM's official downloads](https://www.scummvm.org/games/#games-drascula), and a script fetches it with checksums; the hosted copy keeps the game's readme and a notice that it is modified. Ghostlight builds on ScummVM and does not claim ScummVM's own work as its own.

The ghost's hint lines are voiced with the [ElevenLabs](https://elevenlabs.io/) API.

</details>

## 10. Accessibility notes

**List mode follows an idea Brandon Cole set out in 2013, and findings come from testing, not assertion.**

<details>
<summary><b>Sources</b></summary>

<br>

List mode, presenting the game as lists of objects, exits and inventory to move through, follows an idea Brandon Cole set out in [Adventuring Blind](https://www.brandoncole.net/?p=128) (August 2013), on how a blind player can work through a point-and-click adventure.

This project does not make claims about what blind or low-vision players need without a source. A blind accessibility consultant tested it during the build and finished the whole game on 16 Nov. Findings come from that testing rather than being asserted here.

</details>

---

**More:** [`docs/kiro-features.md`](docs/kiro-features.md) · [`docs/kiro-process.md`](docs/kiro-process.md) · [`packs/FORMAT.md`](packs/FORMAT.md) · [`mcp/README.md`](mcp/README.md) · [`LICENSE`](LICENSE) · [`NOTICE`](NOTICE) · [`packs/LICENSE`](packs/LICENSE)
