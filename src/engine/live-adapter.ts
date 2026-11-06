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

/**
 * The subset of the Emscripten Module the live adapter needs at send time: its
 * MEMFS, through which the page writes the command file. boot.ts produces the
 * real object (the ScummVM wasm build populates `window.Module.FS` once the
 * wasm has instantiated, i.e. by the time the first room state arrives).
 */
export interface ScummvmModule extends ScummvmBootModule {
  /** Emscripten MEMFS; the page writes the command file through it. */
  FS: {
    writeFile(path: string, data: string): void;
    readFile?(path: string, opts: { encoding: "utf8" }): string;
  };
}

/** Where the engine reads commands from (launch with --savepath=/tmp). */
const COMMAND_FILE = "/tmp/a11y-cmd.txt";

export class LiveAdapter implements EngineAdapter {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private module: ScummvmModule | undefined;
  /** The base URL the wasm and /data are served from (Worker root by default). */
  private readonly baseUrl: string | undefined;

  /**
   * @param module a pre-booted Module (tests may inject one). Omitted in the
   *   browser, where `start()` boots the real wasm.
   * @param baseUrl where `scummvm.js` and `/data` are served from. The local
   *   Playwright check overrides this; in production it defaults to "/".
   */
  constructor(module?: ScummvmModule, baseUrl?: string) {
    this.module = module;
    this.baseUrl = baseUrl;
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
    // The booted Module gains FS once the wasm instantiates; keep a reference
    // for send(). The cast is sound: ScummvmModule only adds the FS member the
    // real Module has by the time send() is called.
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
    if (!this.module || !this.module.FS) {
      throw new Error(
        "LiveAdapter.send() has no booted Module; call start() first (or pass " +
          "a Module). Use ReplayAdapter (?replay=) for the recorded path.",
      );
    }
    this.module.FS.writeFile(COMMAND_FILE, serializeCommand(cmd) + "\n");
  }
}
