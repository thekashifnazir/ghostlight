# Design: web-build (live wasm engine in the browser)

## Overview

This spec makes the patched Drascula engine run in the browser and lets the player drive it live. Everything here follows directly from spike 03 (`reference/spikes/03-web-build.md`), which proved the mechanism on the first try: a ScummVM Emscripten build with only the Drascula engine plus our `engine/` patch boots into room 62, emits every `A11Y` line on the console, and takes commands written to a file in the Emscripten file system.

The spike proved it with throwaway scripts and the stock ScummVM shell page. This spec replaces those with:

1. `scripts/build-web.sh` — a reproducible macOS Emscripten build that works around the stock `build.sh`'s Linux assumptions and never touches game data.
2. `src/engine/boot.ts` + finished `src/engine/live-adapter.ts` — the real boot and the live `EngineAdapter`, decoding A11Y lines through the same `parseA11yLine` the replay path uses.
3. The start gate's real job — resume/create audio and boot the engine on the first user gesture.
4. Cloudflare hosting under `web/` — a Worker with static assets for the page, wasm and small files, and `Packet.001` from R2 because it is over the 25 MiB static-asset limit.
5. A Playwright check that boots the live build locally and reaches room 62.

The guiding constraint is that the live path and the replay path must stay identical from `parseA11yLine` onward. The player spec built the whole interaction model against the replay adapter. The live adapter's only new responsibilities are *booting the wasm*, *installing `printErr`*, and *writing the command file*. Everything downstream — the typed `EngineEvent`s, the model, the UI — is unchanged and untouched by this spec.

### A separate ScummVM tree for the Emscripten build

The native engine build lives in `vendor/scummvm` and is owned by the engine-a11y-layer chat. An Emscripten `configure` run writes a different `config.mk`/`config.h` over that tree and would overwrite the native chat's build. So this spec never configures or builds in `vendor/scummvm`. Instead it uses a **separate working tree, `vendor/scummvm-web`**, made from the same pinned commit (`ad351d1e`) — exactly as the spike did (`git -C scummvm archive HEAD | tar -x -C scummvm-web`). Both trees carry the same `engine/` patch; only `vendor/scummvm-web` is ever configured for Emscripten. `vendor/` is gitignored, so neither tree is committed.

### What this spec does not touch

- `engine/` (the patch and A11Y contract) — owned by the engine-a11y-layer spec.
- `src/main.ts` — owned by the player spec, except the single additive `?live` wiring that is this spec's final task, done after the player spec's task 18.
- `scripts/build-engine.sh` — the native/engine build; `build-web.sh` reuses its `engine/`→ScummVM flow but is a separate script.
- `vendor/scummvm` — the native chat's build tree; this spec never configures or builds there. All Emscripten work happens in `vendor/scummvm-web`.
- The start gate's DOM and `main.ts` gesture handler — owned by the player spec. This spec confirms the live adapter plugs into the existing gate; any change the gate needs is noted for the `?live` wiring task (task 7), not made by editing player files.
- The `EngineAdapter` interface, the A11Y types in `adapter.ts`, and `parseA11yLine` — frozen. The live adapter implements the interface and decodes with the shared parser.

## Architecture

```
Browser
 ├─ Ghostlight page (player spec)
 │   ├─ start gate  ──first gesture──▶ resume/create AudioContext
 │   │                                 └▶ adapter.start()
 │   ├─ LiveRegion, list mode, controller  (player spec, unchanged)
 │   └─ EngineAdapter  = LiveAdapter (this spec)  |  ReplayAdapter (player spec)
 │
 └─ LiveAdapter.start()  ──▶  boot.ts
         │                      ├─ set window.Module { canvas, arguments, printErr, locateFile, ... }
         │                      ├─ install A11Y reader on Module.printErr
         │                      ├─ load scummvm.js  (instantiates scummvm.wasm)
         │                      └─ resolve on first A11Y room state
         │
         ├─ reader:  printErr(line) → parseA11yLine(line) → EngineEvent → listeners
         └─ send(cmd): FS.writeFile('/tmp/a11y-cmd.txt', serializeCommand(cmd)+'\n')

Engine (scummvm.wasm, Drascula only + engine/ patch)
         ├─ emits A11Y / A11Y_DIFF / A11Y_TEXT … on stderr → Module.printErr
         └─ polls /tmp/a11y-cmd.txt each frame, runs the command, empties it

Build (separate tree, never vendor/scummvm)
 vendor/scummvm-web  (same pinned commit, same engine/ patch, Emscripten only)
   └─ build-emscripten/  scummvm.wasm, scummvm.js, /data (Packet.001, drascula.dat, Ogg, index.json)

Hosting (web/)
 Cloudflare Worker (static assets)
   ├─ page, scummvm.js, scummvm.wasm (application/wasm), index.json, small data  ◀ static assets (<25 MiB)
   └─ GET /data/.../Packet.001  ──▶  R2 object  (binary type, long cache)
```

### The one invariant: one decoder, two adapters

```
raw A11Y line ─┐
               ├─▶ parseA11yLine ─▶ EngineEvent ─▶ player model/UI
replay log ────┘       (shared, frozen)
```

`ReplayAdapter` reads lines from a recorded log; `LiveAdapter` reads lines from `Module.printErr`. Both call the exact same `parseA11yLine`. This is why the player could be built entirely against replay and why the live build is a drop-in: the only difference is where the lines come from and where commands go.

## Components

### 1. `scripts/build-web.sh` (Requirement 1)

A standalone script that produces the Emscripten output in a **separate `vendor/scummvm-web` tree**, never in `vendor/scummvm` (which holds the native chat's build). It reuses `build-engine.sh`'s philosophy — never hand-edit ScummVM, flow all changes through `engine/` — but targets the web and fixes the spike's two Linux assumptions.

Structure, mirroring the spike's proven sequence:

0. **Materialize `vendor/scummvm-web` from the same pinned commit.** If `vendor/scummvm-web` does not exist, create it from the already-fetched `vendor/scummvm` at the pinned commit, as the spike did: `git -C vendor/scummvm archive HEAD | tar -x -C vendor/scummvm-web` (optionally `git init` in it so `hooks.patch` can be applied with `git apply`). This keeps the native tree untouched; an Emscripten `configure` only ever runs in `vendor/scummvm-web`.
1. **Preflight.** Confirm `vendor/scummvm` exists (fetched by `scripts/fetch.sh`) as the source for the web tree, confirm `engine/a11y.cpp`/`a11y.h` exist, confirm `python3` is available (the HTTP index generator needs it). Fail with a named-tool message otherwise (R1.8).
All of steps 2–6 run inside `vendor/scummvm-web`.

2. **emsdk, pinned to 4.0.10, fetched with curl.** The stock `dists/emscripten/build.sh` uses `wget`, which macOS lacks. Fetch the emsdk 4.0.10 tarball with `curl -sSLO`, unpack it into `vendor/scummvm-web/dists/emscripten`, and run `./emsdk install 4.0.10` then activate it. Skip the fetch if the pinned emsdk is already unpacked (R1.2, R1.3). This is the exact workaround the spike documents.
3. **Engine source flow.** Copy `engine/a11y.cpp` and `engine/a11y.h` into `vendor/scummvm-web/engines/drascula`, register `a11y.o` in that tree's `module.mk` idempotently, and apply `engine/hooks.patch` if it has diff hunks — the same three steps `build-engine.sh` performs, so a fresh `vendor/scummvm-web` plus this script reproduces the build from `engine/` alone (R1.6, R1.9).
4. **Configure.** In `vendor/scummvm-web`: `./dists/emscripten/build.sh configure --disable-all-engines --enable-engine=drascula --disable-debug --enable-ogg --enable-vorbis --enable-zlib`. The Ogg/Vorbis flags are mandatory: without them configure finds neither codec and the music pack is silent (R1.5). `build.sh configure` activates the emsdk itself. This `configure` writes only into `vendor/scummvm-web`, never the native `vendor/scummvm` tree.
5. **Build, sized with sysctl.** Source `vendor/scummvm-web/dists/emscripten/emsdk-4.0.10/emsdk_env.sh`, then `emmake make -j"$JOBS"` and `emmake make dist-emscripten`. `$JOBS` comes from `sysctl -n hw.ncpu` with a fallback (e.g. 4) when neither `sysctl` nor `nproc` is present — the make step of the stock `build.sh` uses `nproc`, which macOS lacks and which would silently fall back to `-j1` (R1.4).
6. **Game data into `/data`, by reference only.** The Emscripten `/data` tree needs the game under `vendor/scummvm-web/build-emscripten/data/games/drascula/` and an `index.json` listing per folder (made by `dists/emscripten/build-make_http_index.py`). The script populates this *from the gitignored `vendor/game/drascula`* that `fetch.sh` produced, and re-runs the index generator. It never copies game data into a tracked path and never stages or commits it (R1.7).

Outputs land in `vendor/scummvm-web/build-emscripten/`: `scummvm.wasm` (10.6 MB), `scummvm.js`, `translations.dat`, themes, and the `data/` tree with `Packet.001`, `drascula.dat`, Ogg tracks and `index.json` files. `dist-emscripten` copies `drascula.dat` into `/data`, so no `--extrapath` is needed.

Design choices and rationale:

- **Separate script, not a flag on `build-engine.sh`.** The instruction forbids editing `build-engine.sh`, and the web build's emsdk handling, configure front-end (`build.sh configure`) and `dist-emscripten`/indexing steps are web-specific. A separate script keeps each readable.
- **Separate tree, native build protected.** All configure/build output goes to `vendor/scummvm-web`, so the engine chat's native build in `vendor/scummvm` is never overwritten. Both trees come from the same pinned commit and carry the same `engine/` patch.
- **No game data commit, ever.** Game data placement reads from `vendor/game/drascula` (gitignored) and writes into `vendor/scummvm-web/build-emscripten/data` (also under gitignored `vendor/`). Nothing the script writes is tracked.
- **Fail loud on missing tools.** Each required tool is checked and named, so a half-configured machine gets one clear line, not a deep make error.

### 2. `src/engine/boot.ts` (Requirement 2)

A small module whose one export boots the wasm `Module` and resolves on the first room state. It is the live adapter's only dependency for booting.

Responsibilities:

- **Configure `window.Module` before loading `scummvm.js`.** The generated `scummvm.js` reads a pre-existing `Module` for its canvas, arguments, `printErr`, and `locateFile` (so the wasm and data URLs resolve to where the Worker serves them). `boot.ts` fills these in. `main.ts` already sets `window.Module = { canvas, printErr }` before boot; `boot.ts` augments that object rather than replacing it, so the canvas the player created is kept.
- **Install the A11Y reader on `Module.printErr` first.** Before `scummvm.js` runs, wrap the existing `printErr` so each line is passed to the previous handler and then to `parseA11yLine`; on a non-null event, forward to the adapter's listeners. Installing before load guarantees no early A11Y line is missed (R2.2, R2.6).
- **Launch arguments.** The engine reads ScummVM arguments from `Module.arguments` (equivalently the URL fragment in the stock shell). `boot.ts` sets them to point at the game in `/data` and to pass `--savepath=/tmp --subtitles`. It must never set the save path to `/home/web_user`, which Emscripten mounts as auto-persisting IndexedDB (R2.4). The game-data path and the absence of `--extrapath` match the spike (`drascula.dat` is in `/data`) (R2.5).
- **Resolve on the first room state.** `boot.ts` returns a promise that resolves when the first `A11Y` room-state event is seen. It subscribes to the reader's output (or is handed a one-shot "first room" signal by the adapter) and resolves then. A timeout rejects with a clear message if no room state arrives, so a broken build fails loudly rather than hanging.

`boot.ts` depends only on `parseA11yLine` and the adapter's event shape. It does not import the model or UI.

### 3. Finish `src/engine/live-adapter.ts` (Requirement 3)

The stub already has the right shape: `onEvent`, `installReader`, `send`, and a throwing `start`. This spec fills in `start` and confirms `send`.

- **`start()`**: call `boot.ts` to configure the Module, install the reader (reusing the adapter's `installReader`, which already wraps `printErr` and runs `parseA11yLine`), load `scummvm.js`, and await the first room-state event. Resolve only after that event has been dispatched to listeners, so by the time `start()` resolves the player has already received a `room` event and read the room (R3.1, R3.2).
- **`send(cmd)`**: unchanged in shape — `FS.writeFile('/tmp/a11y-cmd.txt', serializeCommand(cmd) + '\n')`. The engine's per-frame poll drains it. Guard: if no `Module`, throw a clear message (R3.3, R3.4).
- **Interface unchanged.** `LiveAdapter implements EngineAdapter` exactly as today; no new methods leak into the interface (R3.5, R3.6).

The reader already lives in `installReader`; `boot.ts` and `start()` wire it to the real Module. The split is: `boot.ts` knows how to load wasm and set arguments; `live-adapter.ts` owns the adapter contract and the command-file write. They share the reader via `installReader`.

### 4. Audio start gate (Requirement 4)

The start gate — its DOM and the `main.ts` gesture handler — belongs to the player spec. This spec does not edit those player files. It designs the live adapter to honour the gate that already exists, and if the gate needs any change to drive a live boot cleanly, that change is noted and folded into the `?live` wiring task (task 7), not made by editing player files here.

The player spec already renders the start gate and, in `main.ts`, creates the AudioContext and calls `adapter.start()` on the first gesture. This spec's design keeps that flow and makes the live adapter honour it:

- The gate text is announced in the live region (player spec's `LiveRegion`), so a blind player hears what to do (R4.1, R4.5).
- The first key press or button activation creates/resumes the AudioContext *inside the gesture handler* (so the browser's autoplay policy is satisfied) and then calls `adapter.start()` (R4.2, R4.3). Spike note: automated Chrome brings the context up `running` without a gesture, but a real visitor sees silence until their first key — the SDL glue in `scummvm.js` resumes a suspended context on `keydown`/`mousedown`/`touchstart`, so the gate's keypress doubles as that resume.
- The start control holds focus on load and the gate is keyboard-operable (R4.4) — already true in `main.ts`.
- When the first room state arrives after boot, the room is announced (R4.6) — this is the player spec's `room`→read-room routing, which fires because `start()` resolves only after the first room event.

No new UI is built here, and no player file is edited here. The design confirms the live adapter plugs into the existing gate so the gate's keypress is what both unlocks audio and boots the engine; any gate adjustment the live boot turns out to need is carried into task 7 with the `?live` wiring.

### 5. Cloudflare hosting under `web/` (Requirement 5)

A Cloudflare Worker with static assets, configured as text under `web/`.

Layout under `web/`:

- The Worker script and its config (e.g. `wrangler.jsonc`/`wrangler.toml`), declaring a static-assets binding for the page and small files and an R2 bucket binding for the big file.
- The built page and small artifacts (or a build/deploy step that places them): `scummvm.js`, `scummvm.wasm`, `translations.dat`, themes, the `index.json` listings, and the small game-data files — everything under 25 MiB.

Serving logic:

- **Static assets** handle the page, `scummvm.js`, `scummvm.wasm`, and files under 25 MiB. The Worker sets `application/wasm` for the wasm and a correct content type per file kind (R5.4). The static-assets layer handles most types; the Worker overrides where needed (notably wasm).
- **`Packet.001` from R2.** `Packet.001` is 32.8 MB, over the 25 MiB static-asset limit (R5.2). The Worker matches the request path for `Packet.001` (the HTTP file system fetches it whole; no range requests), reads it from the R2 bucket binding, and streams it back with a binary content type (e.g. `application/octet-stream`) and a long-lived `Cache-Control` (immutable, long max-age) so repeat loads hit cache (R5.3). The game-data fetch is whole-file, so range support is not required.
- **No committed game data.** The deploy step uploads `Packet.001` to R2 from the build output in `vendor/` (gitignored); nothing game-data is tracked in `web/` or elsewhere (R5.5). The hosted data carries the game readme and a modified-data notice (R5.6).
- **No secrets.** The Worker config is reviewable text with no embedded key; Cloudflare credentials are supplied at deploy time (environment / `wrangler login`), referenced by name, never committed — consistent with the API-keys rule (R5.7).

Design choices:

- **Worker + static assets, not Pages.** Pages has the same 25 MiB per-file limit, and a Worker gives a clean place to proxy `Packet.001` from R2 with explicit headers. Workers static assets serve everything else at near-zero cost.
- **R2 only for the one oversized file.** Everything else is a static asset. This keeps the R2 surface tiny (one object) and the config simple.
- **Whole-file R2 reads.** Because the Emscripten HTTP file system fetches whole files, the Worker does a plain `bucket.get(key)` and streams the body; no `Range` handling is designed in (and the spike confirms no range requests yet).

### 6. Playwright live check (Requirement 6)

A Playwright spec, kept separate from the replay-based player tests, that exercises the real build.

- **Serve locally.** Serve `vendor/scummvm-web/build-emscripten/` (wasm + `/data`) over a local static server, and the page in live mode (`?live`), on localhost — the same shape as the spike's `python3 -m http.server` plus the page.
- **Skip when no build.** Before anything, check that `scummvm.wasm` and the game data exist under `vendor/scummvm-web/build-emscripten/`. If not, `test.skip` with a message naming `scripts/build-web.sh` and `scripts/fetch.sh` (R6.3). This is what keeps the player's replay suite green on a machine with no wasm build (R6.5).
- **Drive by keyboard only.** Load the page, press a key to pass the start gate (which also unlocks audio and boots), and wait for boot (R6.1, R6.4). No canvas pixel reads.
- **Assert room 62.** Capture A11Y lines (via `page.on('console')`, as the spike's `drive.mjs` did, or by observing the live region) and assert an `A11Y` room state for room 62 — the tavern, the spike's proven entry point (R6.2).
- **Separable.** This spec lives in its own Playwright project/file so the player suite runs without it (R6.5).

### 7. `?live` wiring into `main.ts` (Requirement 7) — final task, after player task 18

The player spec's `main.ts` already selects `ReplayAdapter` on `?replay=` and otherwise `new LiveAdapter()`. This spec's final task makes the live choice explicit and opt-in:

- Select `LiveAdapter` only when `?live` is present; otherwise keep the existing selection (replay via `?replay=`, else the default) (R7.1, R7.3).
- The edit is additive — a branch in the existing `chooseAdapter`/selection, not a rewrite (R7.4).
- It runs only after the player spec's task 18 has created `main.ts` with boot and event routing (R7.2). Until then, the player builds and tests against replay, untouched by this spec.

Because `start()` now really boots the wasm, `?live` turns the already-wired start gate into a real engine launch with no other change to `main.ts`.

## Data flow: a live command round-trip

```
player presses Up on the focused bartender
  → controller → adapter.send({verb:"look", target:52})
  → LiveAdapter.send: FS.writeFile('/tmp/a11y-cmd.txt', 'look 52\n')
  → engine poll reads the file, runs checkAction, empties the file
  → engine emits on stderr:  A11Y_CMD look 52
                             A11Y_TEXT I CAN'T SEE ANYTHING IN PARTICULAR
                             A11Y_DIFF { "cmd":"look 52", "changed":false, "said":[…] }
  → Module.printErr(line) for each
  → reader: parseA11yLine(line) → EngineEvent
  → adapter listeners → main.ts handleEvent → LiveRegion.announce(text)
  → screen reader speaks it
```

This is byte-for-byte the same decode and routing the replay adapter drives; only the source of the lines (real `printErr` vs recorded log) and the sink of the command (real `FS.writeFile` vs log matcher) differ.

## Error handling

- **Missing build tools** (`build-web.sh`): preflight checks name the missing tool and exit non-zero (R1.8).
- **No room state after boot** (`boot.ts`): the boot promise rejects on a timeout with a message pointing at the build/data, rather than hanging the start gate.
- **`send`/`start` with no Module** (`live-adapter.ts`): throw a clear message, never silent no-op (R3.4).
- **No local build** (Playwright): skip with a message naming the build and fetch scripts, so absence of a wasm build is not reported as a live-path failure (R6.3).
- **R2 object missing** (Worker): return a clear error status for the `Packet.001` path rather than a static 404 that looks like a routing bug.

## Testing strategy

- **Reproducibility of the build.** `build-web.sh` is verified by running it on macOS from a fresh `vendor/` (via `fetch.sh`) and confirming it creates `vendor/scummvm-web`, produces `scummvm.wasm` and a populated `/data` tree there, with Ogg/Vorbis enabled in the configure summary, leaves `vendor/scummvm` (the native tree) untouched, and stages no game data in git.
- **Boot and live round-trip.** The Playwright live check (R6) is the end-to-end test: it boots the real wasm and asserts room 62, then (optionally) sends one command and asserts the resulting A11Y text, mirroring the spike's `verb 1` / `click 52` round-trip.
- **Replay path untouched.** The player's existing vitest and Playwright suites continue to run against the replay adapter with no `?live`, confirming Requirement 7's "replay path intact". The live check is a separate Playwright project that skips without a build.
- **No canvas reads.** Every check drives the page by keyboard and reads A11Y lines (console or live region), never pixels, consistent with the accessibility rules.

## Licensing and secrets

- `scripts/build-web.sh`, `src/engine/boot.ts`, the `web/` Worker and the Playwright check are new project code and are MIT, like the rest of `src/` and `scripts/`. They do not modify GPL engine code; the GPL stays with `engine/` and the built wasm.
- The built wasm is GPL-3.0-or-later (it is ScummVM). Hosting it is fine; the hosted copy carries ScummVM's notices, and the game data carries the game readme plus the modified-data notice (R5.6).
- No key is committed anywhere. Cloudflare credentials are supplied at deploy time and referenced by name (R5.7).
