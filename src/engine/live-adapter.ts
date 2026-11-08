// Live adapter (Requirement 3) — the real EngineAdapter against the wasm build.
//
// This is the live half of the seam the player spec built against replay. Its
// only new responsibilities over the replay adapter are *booting the wasm*
// (delegated to boot.ts), *installing the A11Y reader on printErr*, and
// *writing the command file*. Everything downstream — the typed EngineEvents,
// the model, the UI — is unchanged, because the read path runs every line
// through the one shared `parseA11yLine`, exactly as the replay adapter does.
//
// It implements the EngineAdapter interface unchanged (start/send/onEvent);
// `installReader` is a helper boot.ts calls, not an interface method. When no
// Module is available, start()/send() throw a clear message rather than
// silently no-op, so an accidental live run without a boot fails loudly.

import {
  type Command,
  type EngineAdapter,
  type EngineEvent,
  serializeCommand,
} from "./adapter.js";
import { parseA11yLine } from "./a11y-lines.js";
import { bootEngine, type ScummvmBootModule } from "./boot.js";

/** Emscripten MEMFS; the page writes the command file through it. */
export interface ScummvmFS {
  writeFile(path: string, data: string): void;
  readFile?(path: string, opts: { encoding: "utf8" }): string;
}

/**
 * The subset of the Emscripten Module the live adapter needs at send time: its
 * MEMFS, through which the page writes the command file. boot.ts produces the
 * real object.
 *
 * NOTE: ScummVM's Emscripten build does NOT hang FS off `Module`. The generated
 * `scummvm.js` exposes `FS` as a plain global (spike 03 drives it with a bare
 * `FS.writeFile('/tmp/a11y-cmd.txt', ...)`), so `Module.FS` is `undefined`.
 * `FS` here is therefore optional; `resolveFS()` reads it from the Module when
 * present and otherwise falls back to `globalThis.FS`.
 */
export interface ScummvmModule extends ScummvmBootModule {
  /** Emscripten MEMFS, if this build hangs it off the Module (ScummVM does not). */
  FS?: ScummvmFS;
}

// Where the engine reads commands from. The engine resolves the command file
// as <savepath>/a11y-cmd.txt (a11y.cpp commandFileNode), and boot launches with
// --savepath=/saves (the IDBFS mount), so the command file lives there too.
// persistence.commit() empties this file before every store sync, so a queued
// command is never persisted to IndexedDB (save-progress R1.4).
import { COMMAND_FILE_NAME, SAVE_DIR } from "./persistence.js";
const COMMAND_FILE = `${SAVE_DIR}/${COMMAND_FILE_NAME}`;

/**
 * Resolve the Emscripten MEMFS. ScummVM's build exposes `FS` as a global rather
 * than as `Module.FS`, so prefer the Module's own FS (for a build or test that
 * sets one) and fall back to `globalThis.FS`. Returns `undefined` when neither
 * is available (no boot yet), which `send()` turns into a loud error.
 */
function resolveFS(module: ScummvmModule | undefined): ScummvmFS | undefined {
  if (module?.FS) return module.FS;
  const g = globalThis as unknown as { FS?: ScummvmFS };
  return g.FS;
}

export class LiveAdapter implements EngineAdapter {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private module: ScummvmModule | undefined;
  /** The base URL the wasm and /data are served from (Worker root by default). */
  private readonly baseUrl: string | undefined;
  /** When set, boot loads this save slot at launch (--save-slot=<n>). */
  private saveSlot: number | undefined;

  /**
   * @param module a pre-booted Module (tests may inject one). Omitted in the
   *   browser, where `start()` boots the real wasm.
   * @param baseUrl where `scummvm.js` and `/data` are served from. The local
   *   Playwright check overrides this; in production it defaults to "/".
   * @param saveSlot a save slot to load at launch (save-progress R5.1). When
   *   set, `start()` boots the engine with `--save-slot=<n>`; when omitted, a
   *   fresh game starts.
   */
  constructor(module?: ScummvmModule, baseUrl?: string, saveSlot?: number) {
    this.module = module;
    this.baseUrl = baseUrl;
    this.saveSlot = saveSlot;
  }

  /**
   * Choose the save slot to boot into, before `start()` is called. The
   * onboarding Continue button uses this to resume from a save on the same
   * boot that its click triggers — so the click's user gesture unlocks audio
   * and boots the loaded slot in one step, with no second start gate and no
   * page reload (save-progress R3.4, R5.1). A no-op once booted.
   */
  setSaveSlot(slot: number | undefined): void {
    this.saveSlot = slot;
  }

  onEvent(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Read path: ScummVM emits A11Y lines on stderr, which Emscripten delivers to
   * `Module.printErr`. We install a printErr that passes each line to the
   * previous handler and then runs it through the one shared `parseA11yLine`,
   * forwarding typed events to listeners — the exact same decode the replay
   * adapter uses, so live and replay cannot drift. boot.ts calls this once, on
   * the Module, before `scummvm.js` loads, so no early A11Y line is missed.
   */
  installReader(module: ScummvmBootModule): void {
    // Keep a reference for send(). The cast is sound: ScummvmModule only adds an
    // optional FS member. ScummVM's build does not populate Module.FS, so
    // send() reads FS from the global via resolveFS(); the Module reference is
    // still useful (and a test may inject a Module that does carry FS).
    this.module = module as ScummvmModule;
    const previous = module.printErr;
    module.printErr = (line: string) => {
      previous?.(line);
      const event = parseA11yLine(line);
      if (event) {
        for (const l of this.listeners) l(event);
      }
    };
  }

  /**
   * Boot the wasm Module via boot.ts, install the A11Y reader, load the loader,
   * and resolve only after the first `A11Y` room-state event has been observed.
   * Because boot subscribes its one-shot room listener through `onEvent` after
   * the player has already registered its own event handler, the player's
   * `room` handler runs first, so by the time `start()` resolves the room has
   * been read (R3.1, R3.2). If a Module was injected (tests), reuse it.
   */
  async start(): Promise<void> {
    this.module = (await bootEngine({
      installReader: (m) => this.installReader(m),
      onEvent: (listener) => this.onEvent(listener),
      baseUrl: this.baseUrl,
      saveSlot: this.saveSlot,
    })) as ScummvmModule;
  }

  /**
   * Write path: a command is written as one line to the engine's command file
   * via `FS.writeFile`; the engine's per-frame poll drains it (see
   * engine/a11y.cpp readCommandFile). The serialisation is the shared
   * `serializeCommand`, so the bytes the engine parses match what the replay
   * adapter matched against. Throws a clear message if no Module is available,
   * so a command sent before a successful boot fails loudly.
   */
  send(cmd: Command): void {
    const fs = resolveFS(this.module);
    if (!fs) {
      throw new Error(
        "LiveAdapter.send() has no MEMFS; call start() first (or pass a " +
          "Module). ScummVM exposes FS as a global, not Module.FS, so this " +
          "means the wasm has not booted. Use ReplayAdapter (?replay=) for " +
          "the recorded path.",
      );
    }
    fs.writeFile(COMMAND_FILE, serializeCommand(cmd) + "\n");
  }
}
