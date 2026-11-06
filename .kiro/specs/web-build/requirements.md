# Requirements: web-build (live wasm engine in the browser)

## Introduction

The web-build spec is what turns Ghostlight from "works against a recorded replay" into "works against the real game running in the browser". The patched Drascula engine (from `engine/`) is compiled to WebAssembly with ScummVM's own Emscripten port, booted on the page, and driven live by the player: the player's A11Y reader listens on `Module.printErr`, and commands are written to `/tmp/a11y-cmd.txt` through the Emscripten file system. The engine then runs its own verify/`checkAction`/`exitRoom` code, not pixel clicks.

Spike 03 (`reference/spikes/03-web-build.md`) proved this mechanism end to end: ScummVM built with only the Drascula engine plus our patch boots straight into room 62 (the tavern), every `A11Y` line comes out on the console, and page JavaScript sends commands by writing the command file. This spec turns that throwaway proof into a reproducible build, a real boot path, and hosting that fits the near-zero-cost Cloudflare stack.

Three facts from the spike shape every requirement here:

- **The stock `build.sh` assumes Linux.** It uses `wget` to fetch emsdk (macOS has no `wget`) and `nproc` to size the make job count (macOS has no `nproc`). Our build script must work on macOS by fetching emsdk with `curl` and sizing jobs with `sysctl`.
- **`/home/web_user` persists to IndexedDB.** Emscripten auto-mounts `$HOME` as IndexedDB with auto-persist. Launching with `--savepath` pointed there would write every command to IndexedDB. We launch with `--savepath=/tmp`, which is in-memory MEMFS.
- **`Packet.001` is 32.8 MB, over Cloudflare's 25 MiB per-file limit** for Workers static assets and Pages. The page, wasm and small files go on Workers static assets; the one big game-data file is served from R2 through the Worker.

### Scope

In scope: the macOS Emscripten build script; booting the wasm `Module` and installing the A11Y reader; finishing the live adapter so it boots and resolves on the first room state; the "press any key to start" audio gate announced in the live region; Cloudflare hosting under `web/` (Worker static assets plus `Packet.001` from R2); and a Playwright check that boots the live build locally and reaches room 62. The final task wires `LiveAdapter` into `main.ts` behind a `?live` flag, and runs only after the player spec's task 18.

Out of scope and owned elsewhere: the engine patch itself and the A11Y line contract (engine-a11y-layer spec); the interaction model, the live region, list mode, the pack reader and the replay path (player spec); sonar and the ghost (their own specs). This spec never edits `engine/`, `src/main.ts`, or `scripts/build-engine.sh`.

### Terms

- **wasm build**: the ScummVM Emscripten output — `scummvm.wasm`, `scummvm.js`, `scummvm.html` and the generated `/data` HTTP file system — built with only the Drascula engine and our `engine/` patch, in the separate `vendor/scummvm-web` tree.
- **`vendor/scummvm-web`**: a second ScummVM working tree, made from the same pinned commit as `vendor/scummvm`, used only for the Emscripten build. It keeps the native build in `vendor/scummvm` (owned by the engine chat) from being overwritten by an Emscripten configure.
- **Module**: the Emscripten `Module` object the generated `scummvm.js` exposes. `Module.printErr` receives stderr lines; `Module.FS` is the in-memory file system.
- **A11Y reader**: the `printErr` hook that passes each line through the shared `parseA11yLine` and emits typed `EngineEvent`s. Already written for the live adapter; this spec installs it on the real `Module`.
- **command file**: `/tmp/a11y-cmd.txt`, the file the engine polls each frame for the next command. The page writes it with `FS.writeFile`.
- **start gate**: the "press any key to start" screen the player spec already renders. This spec gives it its real job: the first user gesture resumes/creates the AudioContext and boots the engine.
- **R2**: Cloudflare's object store, where `Packet.001` lives because it exceeds the 25 MiB static-asset limit.
- **Worker**: the Cloudflare Worker (with static assets) that serves the page, wasm and small files, and proxies `Packet.001` from R2 with correct content types and caching.
- **game data**: the Drascula freeware data (`Packet.001`, `drascula.dat`, Ogg tracks, `index.json` listings). Never committed; fetched by `scripts/fetch.sh` from ScummVM's official downloads.

## Requirements

### Requirement 1: Reproducible macOS Emscripten build of the Drascula wasm

**User story:** As a developer on macOS, I want one script that builds the patched Drascula engine to WebAssembly without hand-editing ScummVM, so that the live build is reproducible and the stock build.sh's Linux assumptions do not block me.

#### Acceptance criteria

1. THE project SHALL provide `scripts/build-web.sh` that produces the ScummVM Emscripten output (`scummvm.wasm`, `scummvm.js`, and the Emscripten `/data` tree) built with only the Drascula engine and the `engine/` patch.
2. THE build script SHALL pin the Emscripten SDK to version 4.0.10.
3. WHEN the pinned emsdk is not already present THEN the build script SHALL fetch it with `curl` (not `wget`), because macOS does not ship `wget`.
4. WHEN the build script sizes the parallel make job count THEN it SHALL derive the count with `sysctl -n hw.ncpu` on macOS (not `nproc`, which macOS does not ship), with a safe fallback when neither is available.
5. THE build script SHALL run the ScummVM configure step with `--enable-ogg --enable-vorbis` so the Ogg music pack is detected and playable; WHERE those flags are omitted configure finds neither codec and the music pack will not play.
6. THE build script SHALL reuse the `engine/` → ScummVM source flow (copy `a11y.cpp`/`a11y.h`, register `a11y.o`, apply `hooks.patch`) rather than editing ScummVM sources by hand, consistent with `scripts/build-engine.sh`.
7. THE build script SHALL NEVER copy, stage, or commit game data; it SHALL only assemble engine output, and any game-data placement into the `/data` tree SHALL reference the files fetched by `scripts/fetch.sh` into gitignored `vendor/`.
8. WHEN a required tool (emsdk after install, `emconfigure`, `emmake`, `python3`) is missing THEN the build script SHALL fail with a clear message naming the missing tool, rather than continuing silently.
9. THE build script SHALL NOT edit `engine/`, `src/main.ts`, or `scripts/build-engine.sh`.
10. THE build script SHALL configure and build in a separate `vendor/scummvm-web` tree, created from the same pinned commit as `vendor/scummvm`, and SHALL NEVER configure or build in `vendor/scummvm`, because an Emscripten configure there would overwrite the native engine build.

### Requirement 2: Boot the wasm Module and install the A11Y reader

**User story:** As a blind player, I want the real engine to boot in my browser and every A11Y line it emits to reach my screen reader, so that I am playing the actual game, not a recording.

#### Acceptance criteria

1. THE project SHALL provide `src/engine/boot.ts` that loads the ScummVM wasm `Module`, configures it, and resolves once the engine has booted to its first room state.
2. WHEN `boot.ts` configures the `Module` THEN it SHALL install the A11Y reader on `Module.printErr` before the engine starts emitting lines, so no A11Y line is lost.
3. THE A11Y reader SHALL pass each line through the shared `parseA11yLine` and deliver typed `EngineEvent`s to the live adapter's listeners, so the live path and the replay path decode identically and cannot drift.
4. WHEN the engine is launched THEN `boot.ts` SHALL pass `--savepath=/tmp` and `--subtitles`, and SHALL NOT point the save path at `$HOME`/`/home/web_user`, because that path is mounted as IndexedDB with auto-persist and would persist every command.
5. THE boot path SHALL point the engine at the Drascula game data in the Emscripten `/data` tree, matching the launch arguments the spike proved (game under `/data/games/drascula`, `drascula.dat` available without `--extrapath`).
6. WHEN a line that is not an A11Y line arrives on `printErr` THEN the reader SHALL leave it to the previously installed handler and SHALL NOT emit an event for it.

### Requirement 3: Finish the live adapter against the real Module

**User story:** As the player, I want the live adapter to actually boot the engine, send commands, and surface the first room state, so that `LiveAdapter` is a working `EngineAdapter`, not a stub.

#### Acceptance criteria

1. THE live adapter's `start()` SHALL boot the wasm `Module` via `boot.ts`, install the A11Y reader, and resolve only after the first `A11Y` room-state event has been observed.
2. WHEN `start()` is awaited THEN the player SHALL have received at least one `room` event by the time the promise resolves, so the first room is read on entry.
3. THE live adapter's `send(cmd)` SHALL serialize the command with the shared `serializeCommand` and write it as one line to `/tmp/a11y-cmd.txt` via `Module.FS.writeFile`, so the bytes the engine parses match what the replay adapter matched against.
4. WHILE no `Module` is available, `send()` and `start()` SHALL fail with a clear message rather than silently no-op, so an accidental live run without a boot fails loudly.
5. THE live adapter SHALL implement the existing `EngineAdapter` interface unchanged (`start`, `send`, `onEvent`), so it is interchangeable with the replay adapter.
6. THE live adapter changes SHALL be confined to `src/engine/live-adapter.ts` and `src/engine/boot.ts`; they SHALL NOT change the `EngineAdapter` interface, the A11Y types, or `parseA11yLine`.

### Requirement 4: Audio start gate after a user gesture

**User story:** As a blind player, I want a clear "press any key to start" step that I hear, so that audio and the engine start on my own gesture rather than failing silently against the browser's autoplay policy.

#### Acceptance criteria

1. THE page SHALL present a start gate that is announced in the live region as text, telling the player to press any key or the start button to begin.
2. WHEN the player makes the first gesture (a key press or activating the start button) THEN the page SHALL create or resume the AudioContext as part of handling that gesture, so audio is allowed to play.
3. WHEN the first gesture is handled THEN the page SHALL boot the engine (call the live adapter's `start()`), and SHALL NOT boot it before a user gesture.
4. THE start gate SHALL be operable with the keyboard alone, and its start control SHALL hold focus when the page loads.
5. WHILE the start gate is showing, functional meaning SHALL NOT depend on audio, colour, position, or the canvas; the live-region text SHALL carry it.
6. WHEN the engine has booted and the first room state arrives THEN the page SHALL announce the room in the live region, so the player hears play has begun.

### Requirement 5: Cloudflare hosting under web/

**User story:** As a judge or player, I want to open one link and play, served at near-zero cost, so that the demo works without a local build.

#### Acceptance criteria

1. THE project SHALL hold the hosting configuration and deploy inputs under `web/`, deploying a Cloudflare Worker with static assets that serves the page, `scummvm.wasm`, `scummvm.js`, and the small game-data and index files.
2. WHERE a file exceeds Cloudflare's 25 MiB static-asset limit — specifically `Packet.001` at 32.8 MB — the Worker SHALL serve it from R2 rather than from static assets.
3. WHEN the Worker serves `Packet.001` from R2 THEN it SHALL set a correct binary content type and a long-lived cache policy, so repeat loads are cheap.
4. THE Worker SHALL serve `scummvm.wasm` with the `application/wasm` content type and each served file with a content type correct for its kind.
5. THE hosting SHALL NOT commit game data to the repository; the deploy step SHALL obtain game data from the fetch/build outputs (gitignored `vendor/`), and R2 SHALL be populated from those outputs, not from a committed copy.
6. WHERE the hosted copy includes game data, it SHALL carry the game's readme and a notice that the data is modified, consistent with the licensing rules.
7. THE `web/` hosting configuration SHALL be reviewable as text (Worker code and its config), and SHALL NOT embed any API key or secret; any credentials SHALL be referenced by name and supplied at deploy time, never committed.

### Requirement 6: Playwright check boots the live build and reaches room 62

**User story:** As a developer, I want an automated check that the live build actually boots and reaches the tavern, so that a regression in the build or boot path is caught, not discovered in the demo.

#### Acceptance criteria

1. THE project SHALL provide a Playwright check that serves the built wasm and game data locally, loads the page in live mode, performs the start gesture, and waits for the engine to boot.
2. WHEN the engine has booted THEN the check SHALL assert that an `A11Y` room state for room 62 (the tavern) is observed, matching the spike's proven entry point.
3. WHEN the built wasm or game data is not present locally THEN the check SHALL skip with a clear message (pointing at `scripts/build-web.sh` and `scripts/fetch.sh`) rather than fail as if the live path were broken, so the replay-based player tests are unaffected on machines without a build.
4. THE Playwright check SHALL drive the page only through the keyboard and the page's own controls, consistent with the keyboard-only accessibility rule, and SHALL NOT read the canvas pixels.
5. THE live check SHALL be separable from the replay-based player tests, so the player suite still runs green on a machine with no wasm build.

### Requirement 7: Live mode is opt-in and leaves the replay path intact

**User story:** As a developer, I want live mode behind a flag that wires in only after the player is finished, so that the player spec keeps building and testing against the replay adapter until the live build exists.

#### Acceptance criteria

1. THE player SHALL select the live adapter only when the page is loaded with a `?live` flag, and SHALL otherwise keep its existing adapter selection (replay via `?replay=`, else the default).
2. THE wiring of `LiveAdapter` into `main.ts` behind `?live` SHALL be the final task of this spec, and SHALL be done only after the player spec's task 18 (the task that creates `main.ts` with boot and event routing).
3. WHEN `?live` is absent THEN the player's behaviour SHALL be unchanged from the player spec, so the replay-based tests continue to pass.
4. THE `?live` wiring SHALL be the only edit this spec makes to `main.ts`, and SHALL be additive to the existing adapter selection, not a rewrite of it.

### Requirement 8: Deploy a preview and measure first load on a real connection

**User story:** As the team, I want the live build deployed to a public preview and its first load timed on a real connection, so that we know the real-world cost of the 33 MB `Packet.001` download before relying on it in the demo.

#### Acceptance criteria

1. THE project SHALL deploy the Worker (with `Packet.001` served from R2) to a Cloudflare `workers.dev` preview URL that opens and boots the live build.
2. THE deploy SHALL upload `Packet.001` to R2 from the `vendor/scummvm-web` build output, not from a committed copy, and SHALL commit no game data and no key.
3. THE team SHALL measure the first load over a real connection — at least total bytes fetched and time to the first room state — and SHALL record those numbers in `docs/kiro-process.md`.
4. THE measurement SHALL be taken against the deployed preview (real network), not only localhost, so the `Packet.001` download cost is reflected.

