# Tasks: web-build (live wasm engine in the browser)

Scope boundaries for every task below:

- Do **not** edit `engine/`, `src/main.ts`, or `scripts/build-engine.sh`. The only edit to `main.ts` is the final task (task 7), which is additive and runs **only after the player spec's task 18**.
- Never copy, stage, or commit game data. Game data is fetched by `scripts/fetch.sh` into gitignored `vendor/` and referenced from there.
- Keep the live path and the replay path identical from `parseA11yLine` onward: do not change the `EngineAdapter` interface, the A11Y types in `src/engine/adapter.ts`, or `src/engine/a11y-lines.ts`.
- Confirm current Emscripten, Cloudflare Workers/R2, Wrangler, and Playwright APIs via the Context7 power as each is first used.

- [x] 1. Write `scripts/build-web.sh` (reproducible macOS Emscripten build)
  - Create `scripts/build-web.sh`: materialize a separate `vendor/scummvm-web` tree from the same pinned commit as `vendor/scummvm` (e.g. `git -C vendor/scummvm archive HEAD | tar -x -C vendor/scummvm-web`) and do all configure/build work there — never configure or build in `vendor/scummvm`, which holds the native chat's build.
  - In `vendor/scummvm-web`: preflight (source tree present, `engine/a11y.cpp`/`a11y.h`, `python3`), fetch emsdk pinned to 4.0.10 with `curl` (not `wget`) into `dists/emscripten` and install/activate it, reuse the `engine/`→ScummVM flow (copy `a11y.cpp`/`a11y.h`, register `a11y.o` idempotently, apply `hooks.patch` if it has hunks), then `build.sh configure --disable-all-engines --enable-engine=drascula --disable-debug --enable-ogg --enable-vorbis --enable-zlib`, then `emmake make -j"$JOBS"` and `emmake make dist-emscripten` with `$JOBS` from `sysctl -n hw.ncpu` and a safe fallback.
  - Populate the Emscripten `/data` tree from `vendor/game/drascula` and re-run `build-make_http_index.py`, by reference only — never stage or commit game data.
  - Fail with a named-tool message when emsdk (post-install), `emconfigure`, `emmake`, or `python3` is missing.
  - Do not edit `engine/`, `src/main.ts`, or `scripts/build-engine.sh`.
  - Verify by running it on macOS from a fresh `vendor/` (via `scripts/fetch.sh`): confirm `vendor/scummvm-web` is created, `scummvm.wasm` and a populated `/data` tree are produced there, the configure summary shows Ogg/Vorbis enabled, `vendor/scummvm` is left untouched, and `git status` shows no game data staged.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

- [x] 2. Write `src/engine/boot.ts` (boot the Module, install the reader)
  - Create `src/engine/boot.ts` exporting a boot function that augments `window.Module` (keeping the canvas `main.ts` set), sets `Module.arguments` to launch Drascula from `/data` with `--savepath=/tmp --subtitles` (never `/home/web_user`) and no `--extrapath`, sets `locateFile` so wasm/data URLs resolve where the Worker serves them, installs the A11Y reader on `Module.printErr` before loading `scummvm.js`, loads `scummvm.js`, and returns a promise that resolves on the first `A11Y` room-state event and rejects on a timeout with a clear message.
  - The reader passes each line to the previous `printErr` handler and then through the shared `parseA11yLine`, forwarding only non-null events; non-A11Y lines emit no event.
  - Depend only on `parseA11yLine` and the adapter event shape — do not import the model or UI, and do not change `adapter.ts` or `a11y-lines.ts`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Finish `src/engine/live-adapter.ts` against the real Module
  - Replace the throwing `start()` stub with a real `start()` that calls `boot.ts` to configure the Module and install the reader (reusing `installReader`), loads the wasm, and resolves only after the first `room` event has been dispatched to listeners.
  - Keep `send(cmd)` writing `serializeCommand(cmd) + "\n"` to `/tmp/a11y-cmd.txt` via `Module.FS.writeFile`; keep the clear-error guards on `start()`/`send()` when no Module is available.
  - Keep `LiveAdapter implements EngineAdapter` unchanged (no new interface methods); confine changes to `src/engine/live-adapter.ts` and `src/engine/boot.ts`.
  - Confirm it type-checks against the interface.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Confirm the start gate boots the live engine after a gesture
  - The start gate (its DOM and the `main.ts` gesture handler) belongs to the player spec. Do not edit any player file here. Confirm against the existing gate that the first gesture creates/resumes the AudioContext inside the gesture handler and then calls `adapter.start()`, that the gate text is announced in the live region, that the start control holds focus and is keyboard-operable, and that the first room state is announced once `start()` resolves.
  - If the gate needs any change to drive a live boot cleanly, do not edit player files: write the change down and fold it into the `?live` wiring task (task 7).
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Create the Cloudflare hosting under `web/`
  - Create `web/` with a Worker (static-assets binding for the page, `scummvm.js`, `scummvm.wasm`, `translations.dat`, themes, `index.json` listings and small data; R2 bucket binding for `Packet.001`) and its `wrangler` config as reviewable text with no embedded secret.
  - Worker logic: serve static assets with correct content types (notably `application/wasm` for the wasm); match the `Packet.001` request path and stream it from R2 with a binary content type and a long-lived immutable `Cache-Control`; return a clear error status when the R2 object is missing.
  - Document the deploy step that uploads `Packet.001` to R2 from the `vendor/` build output and ships the game readme plus a modified-data notice; commit no game data and no key, and reference Cloudflare credentials by name only.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 6. Playwright check: boot the live build and reach room 62
  - Add a Playwright spec in its own project/file (separate from the replay-based player tests) that serves `vendor/scummvm-web/build-emscripten/` (wasm + `/data`) locally, loads the page with `?live`, passes the start gate by keyboard, waits for boot, and asserts an `A11Y` room state for room 62.
  - Skip with a clear message naming `scripts/build-web.sh` and `scripts/fetch.sh` when `scummvm.wasm` or the game data is absent under `vendor/scummvm-web/build-emscripten/`, so the player's replay suite stays green on machines with no build.
  - Drive by keyboard and read A11Y lines (console or live region) only — never canvas pixels.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 7. Wire `LiveAdapter` into `main.ts` behind `?live` (final; after player task 18)
  - **Precondition: do not start this task until the player spec's task 18 (create `main.ts` with boot and event routing) is complete.**
  - Make the smallest additive edit to `src/main.ts`'s existing adapter selection: choose `LiveAdapter` only when `?live` is present; otherwise keep the current selection (`?replay=`, else default) unchanged.
  - Do not rewrite the selection logic or make any other change to `main.ts`.
  - **Gate change folded in from task 4 confirmation:** the existing start gate meets R4.2–R4.6 as-is (AudioContext created in the gesture handler then `adapter.start()`; Start button holds focus via `autofocus` + `startButton.focus()` and is keyboard-operable; the first room is announced when `start()` resolves via `room`→`applyRoom`→`readRoom`). The one gap for R4.1 is that the gate's instruction text lives only as static markup in `index.html` and is never put through the live region. Fold in one additive line in `boot()` setup — `live.announce(startGate.querySelector("p")?.textContent ?? "…")` (or the equivalent gate-text string) when the gate is shown — so the gate instruction is announced in `role=log` as text. This is additive (no change to the selection logic) and is the only gate adjustment the live boot needs.
  - Verify: with `?live` the live Playwright check (task 6) boots the real engine and reaches room 62; without `?live` the player's existing vitest and Playwright (replay) suites still pass unchanged.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 8. Deploy a workers.dev preview, upload Packet.001 to R2, and time the first load (do not start until Kash says go)
  - **Precondition: do not start this task until Kash explicitly says go.**
  - Deploy the Worker to a Cloudflare `workers.dev` preview and upload `Packet.001` to R2 from the `vendor/scummvm-web` build output; commit no game data and no key, and reference Cloudflare credentials by name only.
  - Open the preview URL, boot the live build, and measure the first load over a real connection: at least total bytes fetched and time to the first room state.
  - Record the preview URL and the measured numbers in `docs/kiro-process.md` (own rows only, `web ·` prefix), and commit the log with explicit paths.
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
