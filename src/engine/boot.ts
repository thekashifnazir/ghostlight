// Boot the ScummVM wasm Module and install the A11Y reader (Requirement 2).
//
// This is the live adapter's one dependency for *booting*. It knows how to
// configure the Emscripten `Module`, install the A11Y reader on `printErr`
// before the engine emits a single line, load `scummvm.js`, and resolve once
// the engine has reached its first room state.
//
// It depends ONLY on `parseA11yLine` and the adapter's event shape (via the
// callbacks passed in). It never imports the model or UI, and it never touches
// `adapter.ts` or `a11y-lines.ts`. The live path and the replay path decode
// identically because both run every line through the one shared
// `parseA11yLine` (here, via the `installReader` the adapter owns).

import type { EngineEvent } from "./adapter.js";
import { currentGame, type GameConfig } from "./game.js";

/**
 * The shape of the Emscripten `Module` the ScummVM wasm build reads. The
 * generated `scummvm.js` looks for a pre-existing `window.Module` and reads
 * `canvas`, `arguments`, `printErr` and `locateFile` from it before it
 * instantiates the wasm. We augment the object `main.ts` already created
 * (keeping its `canvas` and whatever `printErr` it set) rather than replacing
 * it.
 */
export interface ScummvmBootModule {
  canvas?: HTMLCanvasElement;
  /** ScummVM command line. We launch Drascula from /data; see below. */
  arguments?: string[];
  /** stderr sink; ScummVM routes A11Y lines here. The reader wraps this. */
  printErr?: (line: string) => void;
  /** Resolve wasm/data URLs to where the Worker (or dev server) serves them. */
  locateFile?: (path: string, prefix: string) => string;
  /**
   * Emscripten MEMFS. ScummVM's build does NOT set this on the Module — it
   * exposes `FS` as a plain global instead — so expect it to stay `undefined`
   * here. The live adapter reads FS from `globalThis.FS` (see live-adapter.ts
   * resolveFS); this member only exists for a test that injects its own FS.
   */
  FS?: unknown;
  [key: string]: unknown;
}

// `window.Module` is declared (more narrowly) in main.ts, which owns that
// global. Boot does not redeclare it — that would clash with main.ts, and this
// spec must not change main.ts except the task-7 `?live` wiring. Instead we
// read/augment the global through a local view that is compatible with the
// narrow shape main.ts sets (canvas + printErr).
function globalModule(): ScummvmBootModule {
  const w = window as unknown as { Module?: ScummvmBootModule };
  return (w.Module ??= {});
}

/** Options the live adapter passes to boot the real Module. */
export interface BootOptions {
  /**
   * Install the A11Y reader on `Module.printErr`. The adapter owns this (its
   * `installReader` wraps the previous handler, runs `parseA11yLine`, and
   * forwards typed events to its listeners), so boot stays decoupled from the
   * listener set and the decode cannot drift from the replay path.
   */
  installReader: (module: ScummvmBootModule) => void;
  /**
   * Subscribe a listener to the adapter's event stream and return an
   * unsubscribe function. Boot uses this only to await the first `room` event;
   * it unsubscribes as soon as that arrives.
   */
  onEvent: (listener: (e: EngineEvent) => void) => () => void;
  /**
   * Where `scummvm.js` is served from. Defaults to the Worker/static-asset
   * root ("/"). The local Playwright check and dev server override this.
   */
  baseUrl?: string;
  /** How long to wait for the first room state before failing loud (ms). */
  timeoutMs?: number;
  /**
   * Load `scummvm.js`. Overridable so tests can boot without a real wasm.
   * Defaults to appending a classic <script> tag for `${baseUrl}scummvm.js`.
   */
  loadScript?: (url: string) => Promise<void>;
  /**
   * Load a saved game at launch (save-progress R5.1). When set, the launch
   * arguments gain `--save-slot=<n>` so the engine loads that slot as it boots
   * — the engine's only load path (there is no in-session load command). When
   * omitted, a fresh game starts and the arguments are byte-identical to the
   * pre-feature launch.
   */
  saveSlot?: number;
}

/** The ScummVM launch arguments the spike proved (03-web-build.md). */
export function launchArguments(
  saveSlot?: number,
  game: GameConfig = currentGame(),
): string[] {
  // --savepath=/saves is the IDBFS mount persistence.ts creates, so save files
  // survive a reload (save-progress R1). The engine reads BOTH the save files
  // and the command file from <savepath> (a11y.cpp commandFileNode resolves
  // "<savepath>/a11y-cmd.txt"), so the command file now lives at
  // /saves/a11y-cmd.txt too — but persistence.commit() only ever syncs the
  // mount on a save (and empties the command file first), so no queued command
  // is ever persisted (R1.4). The save path must NOT be /home/web_user, which
  // Emscripten auto-persists wholesale; /saves is mounted and synced
  // deliberately by persistence.ts instead.
  // --subtitles is mandatory or the game draws no text. The game lives under
  // /data/games/drascula and drascula.dat is in /data, so no --extrapath.
  //
  // --music-volume=51 launches the game's music at about 20% of ScummVM's
  // default (255), low enough that the actors' spoken lines stand out clearly
  // over it under a screen reader. The ghost whisper and sonar pings play
  // through the page's own Web Audio graph (not the engine mixer), boosted
  // above unity so they too sit clearly over the music. ScummVM exposes no
  // runtime music-volume command to the a11y layer, so the music level is fixed
  // at launch, not ducked further live per-cue (see audio.ts comments).
  const args = [
    "--savepath=/saves",
    "--subtitles",
    "--music-volume=51",
    // --speech-volume=255 keeps the actors' voices at full level so they sit
    // clearly over the music (which launches at 51); the ghost whisper and
    // sonar play through the page's own Web Audio graph, not this mixer.
    "--speech-volume=255",
  ];
  // --save-slot=<n> is the engine's launch-time load (save-progress R5.1). It
  // is appended only when a slot is requested, so a fresh start keeps the exact
  // argument list the pre-feature build used (minus the save-path move).
  if (saveSlot !== undefined) {
    args.push(`--save-slot=${saveSlot}`);
  }
  args.push("-p", game.dataDir, game.scummvmId);
  return args;
}

/** Default script loader: a classic <script> tag that resolves on load. */
function loadScriptTag(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new Error(`failed to load the ScummVM loader at ${url}`));
    document.head.appendChild(el);
  });
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Boot the wasm Module and resolve on the first room state.
 *
 * Order matters: we configure `Module` and install the A11Y reader *before*
 * loading `scummvm.js`, so no early A11Y line is missed (R2.2). We subscribe a
 * one-shot listener for the first `room` event, load the loader, and resolve
 * when that event arrives. A timeout rejects with a clear message so a broken
 * build fails loudly instead of hanging the start gate.
 *
 * @returns the booted `Module` (its `FS` is then available to the adapter's
 *   `send()` for writing the command file).
 */
export async function bootEngine(
  options: BootOptions,
): Promise<ScummvmBootModule> {
  const {
    installReader,
    onEvent,
    baseUrl = "/",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    loadScript = loadScriptTag,
    saveSlot,
  } = options;

  // Augment the Module main.ts already created (keep its canvas). If main.ts
  // has not run (e.g. a test harness), start a bare object.
  const module: ScummvmBootModule = globalModule();

  // ScummVM's SDL/Emscripten graphics backend creates its WebGL context on the
  // canvas with id "canvas" (the stock ScummVM shell's canvas has that id).
  // With any other id, SDL_GL_CreateContext fails ("That operation is not
  // supported"), the OpenGL graphics manager cannot load a mode, and the engine
  // exits to the launcher instead of running the game. main.ts's canvas is
  // #game-canvas, so give the Module's canvas the id SDL expects before the
  // loader runs. This is additive (an id the rest of the page does not rely on)
  // and keeps main.ts's own #game-canvas lookup working.
  if (module.canvas && module.canvas.id !== "canvas") {
    module.canvas.id = "canvas";
  }

  const args = launchArguments(saveSlot);
  module.arguments = args;

  // The ScummVM build's bundled --pre-js (dists/emscripten/custom_shell-pre.js)
  // RESETS Module.arguments to [] and repopulates it from `window.location.hash`
  // when scummvm.js runs — so the hash, not Module.arguments, is what actually
  // reaches the engine. Set the hash to the launch args (space-joined) before
  // loading the loader, exactly as the spike launched the stock shell
  // (scummvm.html#--savepath=/tmp --subtitles -p /data/games/drascula drascula).
  // Guard for a non-browser harness that stubs loadScript.
  if (typeof window !== "undefined" && window.location) {
    window.location.hash = args.join(" ");
  }

  // Resolve wasm/data URLs. The stock ScummVM shell sets NO locateFile and lets
  // Emscripten resolve names relative to scummvm.js's own URL, which works when
  // the engine and page share an origin (our hosting serves both under the same
  // root). So only install a locateFile when a caller explicitly overrides the
  // base to a different root (e.g. a test serving the build elsewhere); a
  // default/"/" base keeps the stock relative resolution the engine expects,
  // because overriding it was observed to break the engine's own game-data
  // path handling and send it to the launcher instead of the game.
  if (baseUrl !== "/" && baseUrl !== "") {
    const prevLocateFile = module.locateFile;
    module.locateFile = (path: string, prefix: string): string => {
      if (/^(https?:)?\/\//.test(path) || path.startsWith("/")) return path;
      if (prevLocateFile) return prevLocateFile(path, prefix);
      return baseUrl + path;
    };
  }

  // Install the A11Y reader on printErr BEFORE the loader runs, so the first
  // A11Y room-state line is captured (R2.2). The adapter's installReader wraps
  // the previous printErr and runs parseA11yLine (R2.3, R2.6).
  installReader(module);

  // Await the first room state. Subscribe before loading so we cannot miss it.
  const firstRoom = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `the engine did not reach a room state within ${timeoutMs}ms. ` +
            `Check that the wasm build and /data are served under ${baseUrl} ` +
            `(scripts/build-web.sh produces them in vendor/scummvm-web/build-emscripten).`,
        ),
      );
    }, timeoutMs);

    const unsubscribe = onEvent((e: EngineEvent) => {
      if (e.type === "room") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });

  // Load the loader (instantiates scummvm.wasm). A load failure rejects before
  // the room timeout can fire, with the clearer message.
  await loadScript(baseUrl + "scummvm.js");

  await firstRoom;
  return module;
}
